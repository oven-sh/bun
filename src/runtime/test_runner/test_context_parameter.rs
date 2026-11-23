//! Parses a callback's parameter list to find which test context properties it destructures.

use bun_ast::b::B;
use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{G, Stmt};
use bun_core::strings;
use bun_jsc::{JSGlobalObject, JSValue, JsError, JsResult};

use super::pretty_format;

/// Parsed at most once. The rows of an `.each()` / `.for()` table share one.
pub(crate) type SharedContextParameter = std::rc::Rc<core::cell::OnceCell<ContextParameter>>;

pub(crate) enum ContextParameter {
    /// No parameter at that index, or a native function.
    Absent,
    /// `({ a, b: c, d = 1 }) => {}` gives `a`, `b`, `d`.
    Properties(Vec<Box<[u8]>>),
    RestProperty,
    /// Not an object pattern. Holds the name if it's a plain identifier.
    Other(Option<Box<[u8]>>),
    /// A function compiled ahead of time, in a build that holds no function source.
    TextLeftOut,
}

pub(crate) const TEXT_LEFT_OUT: &str = "fixtures are chosen by the properties that a callback destructures, and this build holds no function source to read them from (--no-compile-function-source)";

unsafe extern "C" {
    safe fn Bun__JSFunction__sourceFromParameters(
        function: JSValue,
        is_arrow_function: &mut bool,
        has_custom_to_string: &mut bool,
    ) -> bun_core::String;
    safe fn Bun__JSFunction__compiledSource(
        function: JSValue,
        is_text_left_out: &mut bool,
    ) -> bun_core::String;
}

impl ContextParameter {
    pub(crate) fn of(global: &JSGlobalObject, function: JSValue, index: usize) -> JsResult<ContextParameter> {
        match Self::of_engine_text(function, index) {
            Some(parameter) => Ok(parameter),
            None => Self::of_to_string(global, function, index),
        }
    }

    /// Runs no JavaScript. `None` for a function whose `toString` is not the built-in, or whose lookup threw: `of_to_string` is next.
    #[optimize(size)]
    pub(crate) fn of_engine_text(function: JSValue, index: usize) -> Option<ContextParameter> {
        let mut is_arrow_function = false;
        let mut has_custom_to_string = false;
        let from_parameters = Bun__JSFunction__sourceFromParameters(function, &mut is_arrow_function, &mut has_custom_to_string);
        if has_custom_to_string {
            return None;
        }
        if from_parameters.is_dead() {
            return Some(Self::of_compiled(function, index));
        }
        let from_parameters = from_parameters.to_utf8();
        // An async generator or async arrow accepts any body, except that `super.x` and `this.#x` need a class.
        // The class wrapper is tried second because class code is strict mode.
        let around: [(&[u8], &[u8]); 2] = if is_arrow_function {
            [(b"(async ", b")"), (b"(class{m(){(async ", b")}})")]
        } else {
            [(b"(async function*", b")"), (b"(class{async*m", b"})")]
        };
        Some(
            around
                .iter()
                .find_map(|(before, after)| {
                    let text = [before, from_parameters.slice(), after].concat();
                    Self::parse(&text, bun_ast::Loader::Js, is_arrow_function, index)
                        .map(|function| function.unwrap_or(ContextParameter::Absent))
                })
                .unwrap_or(ContextParameter::Other(None)),
        )
    }

    /// Vitest reads the parameters from what `toString()` returns, which a wrapper sets to the text of the function it wraps.
    #[cold]
    pub(crate) fn of_to_string(global: &JSGlobalObject, function: JSValue, index: usize) -> JsResult<ContextParameter> {
        // Thrown by the lookup in `of_engine_text`.
        if global.has_exception() {
            return Err(JsError::Thrown);
        }
        let function = function.without_async_context();
        let to_string = pretty_format::member(global, function, "toString")?;
        if !to_string.is_callable() {
            return Err(global.throw_type_error(format_args!("callback.toString is not a function")));
        }
        let text = to_string.call(global, function, &[])?;
        if !text.is_string() {
            return Ok(ContextParameter::Absent);
        }
        let text = text.to_utf8(global)?;
        if let Some(parameter) = Self::of_whole(text.slice(), index, || None) {
            return Ok(parameter);
        }
        if text.slice().ends_with(b"{ [native code] }")
            && bun_jsc::compiled_program::compiled_program().is_some_and(bun_jsc::compiled_program::omits_function_source)
        {
            return Ok(ContextParameter::TextLeftOut);
        }
        // Not one function: chai-spies puts a line in front. Vitest takes what follows the first parenthesis as the parameters.
        let Some(parameters) = Self::first_parenthesized(text.slice()) else {
            return Ok(ContextParameter::Absent);
        };
        let arrow_function = [b"(", parameters, b"=>{})"].concat();
        Ok(Self::parse(&arrow_function, bun_ast::Loader::Jsx, false, index)
            .flatten()
            .unwrap_or(ContextParameter::Other(None)))
    }

    /// From the first `(` outside of a comment to the `)` that closes it, or to the end if none does.
    fn first_parenthesized(text: &[u8]) -> Option<&[u8]> {
        let mut start = None;
        let mut depth = 0usize;
        let mut at = 0;
        while at < text.len() {
            let rest = &text[at..];
            match rest[0] {
                b'/' if rest.starts_with(b"//") => at += strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len()),
                b'/' if rest.starts_with(b"/*") => at += strings::index_of(&rest[2..], b"*/").map_or(rest.len(), |end| end + 3),
                quote @ (b'"' | b'\'' | b'`') if start.is_some() => {
                    at += 1;
                    while at < text.len() && text[at] != quote {
                        at += 1 + usize::from(text[at] == b'\\');
                    }
                }
                b'(' => {
                    start.get_or_insert(at);
                    depth += 1;
                }
                b')' if depth > 0 => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&text[start?..=at]);
                    }
                }
                _ => {}
            }
            at += 1;
        }
        start.map(|start| &text[start..])
    }

    /// The whole function as written, without its types, if `bun test --aot` compiled it.
    #[cold]
    fn of_compiled(function: JSValue, index: usize) -> ContextParameter {
        let mut is_text_left_out = false;
        let whole = Bun__JSFunction__compiledSource(function, &mut is_text_left_out);
        if whole.is_dead() {
            return match is_text_left_out {
                true => ContextParameter::TextLeftOut,
                false => ContextParameter::Absent,
            };
        }
        Self::of_whole(whole.to_utf8().slice(), index, || Some(ContextParameter::Absent)).unwrap_or(ContextParameter::Other(None))
    }

    /// `whole` is a function as `toString()` shows it. `None` if it does not parse.
    fn of_whole(whole: &[u8], index: usize, not_a_function: fn() -> Option<ContextParameter>) -> Option<ContextParameter> {
        // A method parses in an object or a class and nowhere else. `this.#x` needs a class.
        let around: [(&[u8], &[u8], bool); 4] = [
            (b"(", b")", false),
            (b"({", b"})", false),
            (b"(class{", b"})", false),
            (b"(class{m(){(", b")}})", true),
        ];
        around.iter().find_map(|&(before, after, is_arrow_in_method)| {
            let text = [before, whole, after].concat();
            Self::parse(&text, bun_ast::Loader::Jsx, is_arrow_in_method, index)?.or_else(not_a_function)
        })
    }

    /// `None` if `text` does not parse, `Some(None)` if it is not one function.
    fn parse(text: &[u8], loader: bun_ast::Loader, is_arrow_function: bool, index: usize) -> Option<Option<ContextParameter>> {
        let arena = bun_alloc::Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(&b"function.js"[..], text);
        let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
        options.features.no_macros = true;
        options.suppress_warnings_about_weird_code = true;
        let define = bun_js_parser::Define::default();
        let mut log = bun_ast::Log::init();
        bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena)
            .and_then(|parser| {
                parser.parse_only(|parsed| {
                    let [Stmt { data: StmtData::SExpr(only), .. }] = parsed.stmts else {
                        return None;
                    };
                    let mut function = &only.value.data;
                    if let Data::EObject(object) = function
                        && let [G::Property { value: Some(method), .. }] = object.properties.as_slice()
                    {
                        function = &method.data;
                    }
                    if let Data::EClass(class) = function
                        && let [G::Property { value: Some(method), .. }] = class.properties.slice()
                    {
                        function = match &method.data {
                            Data::EFunction(m) if is_arrow_function => match m.func.body.stmts.slice() {
                                [Stmt { data: StmtData::SExpr(arrow), .. }] => &arrow.value.data,
                                _ => return None,
                            },
                            method => method,
                        };
                    }
                    let (args, has_rest_arg): (&[G::Arg], bool) = match function {
                        Data::EArrow(arrow) => (arrow.args.slice(), arrow.has_rest_arg),
                        Data::EFunction(function) => (
                            function.func.args.slice(),
                            function.func.flags.contains(bun_ast::flags::Function::HasRestArg),
                        ),
                        _ => return None,
                    };
                    let Some(arg) = args.get(index) else {
                        return Some(ContextParameter::Absent);
                    };
                    Some(match &arg.binding.data {
                        B::BObject(_) if has_rest_arg && index + 1 == args.len() => ContextParameter::Other(None),
                        B::BObject(object) => Self::properties(object.properties.slice(), &arena),
                        B::BIdentifier(id) if !(has_rest_arg && index + 1 == args.len()) => {
                            ContextParameter::Other(Some(parsed.name_of(id.r#ref).into()))
                        }
                        _ => ContextParameter::Other(None),
                    })
                })
            })
            .ok()
    }

    #[optimize(size)]
    fn properties(properties: &[bun_ast::b::Property], arena: &bun_alloc::Arena) -> ContextParameter {
        let mut names = Vec::with_capacity(properties.len());
        for property in properties {
            if property.flags.contains(bun_ast::flags::Property::IsSpread) {
                return ContextParameter::RestProperty;
            }
            if property.flags.contains(bun_ast::flags::Property::IsComputed) {
                continue;
            }
            match &property.key.data {
                Data::EString(name) => {
                    if let Ok(name) = name.string(arena) {
                        names.push(name.into());
                    }
                }
                // `({ 0: first }) => {}`
                Data::ENumber(index)
                    if index.value() >= 0.0 && index.value() <= f64::from(u32::MAX) && index.value().fract() == 0.0 =>
                {
                    names.push((index.value() as u32).to_string().into_bytes().into());
                }
                _ => {}
            }
        }
        ContextParameter::Properties(names)
    }
}

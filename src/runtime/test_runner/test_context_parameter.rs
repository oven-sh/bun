//! What a callback asks of the test context: the properties its parameter destructures.

use bun_ast::b::B;
use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{G, Stmt};
use bun_jsc::JSValue;

/// Of the callback of an entry, read when it is first asked for. The rows of a table share one.
pub(crate) type SharedContextParameter = std::rc::Rc<core::cell::OnceCell<ContextParameter>>;

pub(crate) enum ContextParameter {
    /// The function has no such parameter, or is not written in JavaScript.
    Absent,
    /// `({ a, b: c, d = 1 }) => {}` is `a`, `b`, `d`.
    Properties(Vec<Box<[u8]>>),
    /// `({ a, ...rest }) => {}`
    RestProperty,
    /// Not an object pattern: its name, if it is a plain parameter.
    Other(Option<Box<[u8]>>),
}

unsafe extern "C" {
    safe fn Bun__JSFunction__sourceFromParameters(
        function: JSValue,
        is_arrow_function: &mut bool,
    ) -> bun_core::String;
}

impl ContextParameter {
    /// The parameter at `index` of `function`.
    pub(crate) fn of(function: JSValue, index: usize) -> ContextParameter {
        let mut is_arrow_function = false;
        let from_parameters = Bun__JSFunction__sourceFromParameters(function, &mut is_arrow_function);
        if from_parameters.is_dead() {
            return ContextParameter::Absent;
        }
        let from_parameters = from_parameters.to_utf8();
        // Any body parses as that of an async generator or arrow; `super.x` and `this.#x` only in a class, which is strict mode code.
        let around: [(&[u8], &[u8]); 2] = if is_arrow_function {
            [(b"(async ", b")"), (b"(class{m(){(async ", b")}})")]
        } else {
            [(b"(async function*", b")"), (b"(class{async*m", b"})")]
        };
        around
            .iter()
            .find_map(|(before, after)| {
                Self::parse(&[before, from_parameters.slice(), after].concat(), is_arrow_function, index)
            })
            .unwrap_or(ContextParameter::Other(None))
    }

    /// `None`: `text` does not parse.
    fn parse(text: &[u8], is_arrow_function: bool, index: usize) -> Option<ContextParameter> {
        let arena = bun_alloc::Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(&b"function.js"[..], text);
        let mut options = bun_js_parser::ParserOptions::init(Default::default(), bun_ast::Loader::Js);
        options.features.no_macros = true;
        options.suppress_warnings_about_weird_code = true;
        let define = bun_js_parser::Define::default();
        let mut log = bun_ast::Log::init();
        bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena)
            .and_then(|parser| {
                parser.parse_only(|parsed| {
                    let [Stmt { data: StmtData::SExpr(only), .. }] = parsed.stmts else {
                        return ContextParameter::Absent;
                    };
                    let mut function = &only.value.data;
                    if let Data::EClass(class) = function
                        && let [G::Property { value: Some(method), .. }] = class.properties.slice()
                    {
                        function = match &method.data {
                            Data::EFunction(m) if is_arrow_function => match m.func.body.stmts.slice() {
                                [Stmt { data: StmtData::SExpr(arrow), .. }] => &arrow.value.data,
                                _ => return ContextParameter::Absent,
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
                        _ => return ContextParameter::Absent,
                    };
                    let Some(arg) = args.get(index) else {
                        return ContextParameter::Absent;
                    };
                    match &arg.binding.data {
                        B::BObject(_) if has_rest_arg && index + 1 == args.len() => ContextParameter::Other(None),
                        B::BObject(object) => Self::properties(object.properties.slice(), &arena),
                        B::BIdentifier(id) if !(has_rest_arg && index + 1 == args.len()) => {
                            ContextParameter::Other(Some(parsed.name_of(id.r#ref).into()))
                        }
                        _ => ContextParameter::Other(None),
                    }
                })
            })
            .ok()
    }

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

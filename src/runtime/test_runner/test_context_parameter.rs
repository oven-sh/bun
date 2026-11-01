//! Parses a callback's parameter list to find which test context properties it destructures.

use bun_ast::b::B;
use bun_ast::expr::Data;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{G, Stmt};
use bun_jsc::JSValue;

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
}

unsafe extern "C" {
    safe fn Bun__JSFunction__sourceFromParameters(
        function: JSValue,
        is_arrow_function: &mut bool,
    ) -> bun_core::String;
}

impl ContextParameter {
    #[optimize(size)]
    pub(crate) fn of(function: JSValue, index: usize) -> ContextParameter {
        let mut is_arrow_function = false;
        let from_parameters = Bun__JSFunction__sourceFromParameters(function, &mut is_arrow_function);
        if from_parameters.is_dead() {
            return ContextParameter::Absent;
        }
        let from_parameters = from_parameters.to_utf8();
        // An async generator or async arrow accepts any body, except that `super.x` and `this.#x` need a class.
        // The class wrapper is tried second because class code is strict mode.
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

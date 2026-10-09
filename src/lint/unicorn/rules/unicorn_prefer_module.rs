use bun_lint_oxlint::ast_util::is_reference_to_global_variable;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Prefer JavaScript modules (ESM) over CommonJS.
pub struct PreferModule;

const COMMON_JS_GLOBALS: [&str; 5] = ["exports", "require", "module", "__filename", "__dirname"];

const USE_STRICT_DIRECTIVE: Message = Message::new("", "Do not use \"use strict\" directive.");
const GLOBAL_RETURN: Message = Message::new("", "\"return\" should be used inside a function.");
const COMMON_JS_GLOBAL: Message = Message::new("", "Do not use \"{{name}}\".");

#[derive(Default)]
pub struct State<'a> {
    common_js_globals: Option<[Name<'a>; 5]>,
    /// What is in a function.
    functions: AncestorMemo<'a, ()>,
}

impl Rule for PreferModule {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-module", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        PreferModule
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if file.path().last_chunk::<4>().is_some_and(|it| it.eq_ignore_ascii_case(b".cjs")) {
            return State::default();
        }
        if file.mentions("use strict") {
            on.stmts([StmtTag::Expr], |_, statement, cx| {
                if matches!(statement.kind(), StmtKind::Expr(e) if e.tag() == ExprTag::String)
                    && statement.directive().is_some_and(|it| it == b"use strict")
                {
                    cx.report(statement, USE_STRICT_DIRECTIVE);
                }
            });
        }
        on.stmts([StmtTag::Return], |_, return_statement, cx| {
            let is_function = |_, parent: Node<'a>| parent.as_func().filter(|it| it.kind() != FnKind::StaticBlock).map(|_| ());
            if cx.state.functions.find(Node::Stmt(return_statement), is_function).is_none() {
                cx.report(return_statement, GLOBAL_RETURN);
            }
        });
        if !file.mentions_any(&COMMON_JS_GLOBALS) {
            return State::default();
        }
        on.exprs([ExprTag::Ident], |_, identifier, cx| {
            if let (Some(name), Some(names)) = (identifier.as_ident(), &cx.state.common_js_globals)
                && names.contains(&name)
                && is_reference_to_global_variable(identifier)
                // `<module />` refers to nothing.
                && !(identifier.is_jsx_tag_name() && name.bytes().first().is_some_and(u8::is_ascii_lowercase))
            {
                cx.report(identifier, COMMON_JS_GLOBAL).data("name", name);
            }
        });
        State { common_js_globals: Some(COMMON_JS_GLOBALS.map(|it| file.name_of(it))), functions: AncestorMemo::default() }
    }
}

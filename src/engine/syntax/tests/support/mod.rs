#![allow(dead_code)]

use core::ops::Range;

use bun_engine_standalone as _;
use bun_engine_syntax::ast::{Ast, Binding, ExprId, ExprKind, Function, ScopeId, StmtKind};
use bun_engine_syntax::{Error, FunctionFlags, FunctionSource, Goal, Name, Options, Parser};
use bun_engine_text::Text;

pub(crate) const SCRIPT: Goal<'static> = Goal::Script { strict: false };

pub(crate) fn options(goal: Goal<'_>, range: Range<u32>) -> Options<'_> {
    const STACK: usize = 512 << 10;
    let marker = 0u8;
    Options {
        goal,
        range,
        builtin: false,
        in_module: false,
        eager_functions: false,
        capture_everything: false,
        stack_limit: (&raw const marker).addr() - STACK,
    }
}

/// In each width that holds it.
pub(crate) fn in_each_width(text: &str, mut check: impl FnMut(Text<'_>)) {
    let units: Vec<u16> = text.encode_utf16().collect();
    let narrow: Option<Vec<u8>> = units.iter().map(|&unit| unit.try_into().ok()).collect();
    if let Some(narrow) = &narrow {
        check(Text::Latin1(narrow));
    }
    check(Text::Utf16(&units));
}

pub(crate) fn parse<'a>(
    parser: &'a mut Parser,
    source: Text<'_>,
    goal: Goal<'_>,
) -> Result<&'a Ast, Error> {
    parser.parse(source, &options(goal, 0..source.len() as u32), None)
}

pub(crate) fn error_of(source: &str, goal: Goal<'_>) -> Option<Error> {
    let mut errors = Vec::new();
    in_each_width(source, |text| {
        errors.push(parse(&mut Parser::default(), text, goal).err());
    });
    let describe = |error: &Option<Error>| format!("{error:?}");
    assert!(errors.iter().all(|it| describe(it) == describe(&errors[0])));
    errors.pop().flatten()
}

pub(crate) fn text_of(ast: &Ast, source: Text<'_>, name: Name) -> String {
    ast.names.text(name, source).to_string()
}

/// Of the first statement.
pub(crate) fn expression(ast: &Ast) -> ExprId {
    match ast[ast.at(ast.root.tree.body, 0)].kind {
        StmtKind::Expression(expression) | StmtKind::Variables(expression) => expression,
        _ => panic!("no expression"),
    }
}

/// The function that the first statement declares or is.
pub(crate) fn function(ast: &Ast) -> Function {
    match ast[ast.at(ast.root.tree.body, 0)].kind {
        StmtKind::Function(function) => ast[function],
        _ => match ast[expression(ast)].kind {
            ExprKind::Function(function) => ast[function],
            _ => panic!("no function"),
        },
    }
}

pub(crate) fn options_for(function: &Function) -> Options<'static> {
    let goal = Goal::Function(FunctionSource {
        kind: function.kind,
        flags: function.flags,
        fields: &[],
    });
    let start = if function.flags.contains(FunctionFlags::BINDS_OWN_NAME) {
        function.start
    } else {
        function.parameters_start
    };
    options(goal, start..function.end)
}

/// `name Kind FLAG | FLAG` for each.
pub(crate) fn bindings(ast: &Ast, source: Text<'_>, scope: Option<ScopeId>) -> Vec<String> {
    let describe = |binding: &Binding| {
        let flags: Vec<&str> = binding.flags.iter_names().map(|(name, _)| name).collect();
        let name = text_of(ast, source, binding.name);
        format!("{name} {:?} {}", binding.kind, flags.join(" | "))
    };
    scope.map_or(Vec::new(), |scope| {
        ast.bindings(scope).iter().map(describe).collect()
    })
}

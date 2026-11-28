//! Helpers for the `bun` plugin's rules about tests. Unlike the `bun:test` rules, these look at every file that
//! `bun test` can run: one that imports from `bun:test`, `vitest` or `@jest/globals`, or that uses the globals.

use crate::jest::{
    self, Arguments, JestFnKind, JestGeneralFnKind, ParsedGeneralJestFnCall, PossibleJestNode,
    Runner, parse_general_jest_fn_call, possible_jest_node_of,
};
use bun_lint::prelude::*;
use bun_lint::types::IdSet;
use bun_lint_oxlint::ast_util::{get_const_variable_initializer, is_global_reference};

pub(crate) fn imports_from<'a>(file: &'a File<'a>, module: &str) -> bool {
    file.mentions(module)
        && (file.body().iter().filter_map(Stmt::as_import))
            .any(|it| it.spec().is(module) && !it.is_type_only())
}

/// The runners whose parsers find the test functions of `file`.
fn runners_for<'a>(file: &'a File<'a>) -> &'static [Runner] {
    let imports_other = imports_from(file, "vitest") || imports_from(file, "@jest/globals");
    match (imports_other, jest::is_for(file, jest::BUN)) {
        (false, _) => &[Runner::Bun],
        (true, false) => &[Runner::Vitest],
        (true, true) => &[Runner::Bun, Runner::Vitest],
    }
}

/// A call of a global is there twice if the file imports from two runners.
pub(crate) fn possible_test_calls<'a>(
    file: &'a File<'a>,
) -> impl Iterator<Item = PossibleJestNode<'a>> {
    (runners_for(file).iter()).flat_map(|it| jest::iter_possible_jest_call_node(file, *it))
}

pub(crate) fn possible_test_call_of(e: Expr<'_>) -> Option<PossibleJestNode<'_>> {
    (runners_for(e.file()).iter()).find_map(|it| possible_jest_node_of(e.file(), *it, e))
}

/// The `test(..)`, `it(..)` or hook call that `callback` is the callback of.
pub(crate) fn test_or_hook_of(callback: Expr<'_>) -> Option<ParsedGeneralJestFnCall<'_>> {
    let parent = callback.parent().as_expr()?;
    if Arguments::of(parent.as_call()?.args(), Runner::Bun).callback != Some(callback) {
        return None;
    }
    let parsed = parse_general_jest_fn_call(callback.file(), possible_test_call_of(parent)?)?;
    matches!(
        parsed.kind,
        JestFnKind::General(JestGeneralFnKind::Test | JestGeneralFnKind::Hook)
    )
    .then_some(parsed)
}

/// `test.each(..)`, `test.for(..)`: the callback's parameters are the row.
pub(crate) fn takes_rows(call: &ParsedGeneralJestFnCall) -> bool {
    (call.members.iter()).any(|it| it.is_name_equal("each") || it.is_name_equal("for"))
}

/// The `done();` that ends `func`, if that's the only use of `done`.
pub(crate) fn only_call_at_the_end<'a>(func: Func<'a>, done: Symbol<'a>) -> Option<Stmt<'a>> {
    let last = func.body_statements()?.last()?;
    let call = last.as_expr()?.as_call()?;
    let mut uses = done.references();
    let (only, None) = (uses.next()?.expr()?, uses.next()) else {
        return None;
    };
    (call.callee() == only && call.args().is_empty() && func.returns().next().is_none())
        .then_some(last)
}

/// For `object.name(..)`, returns `object` and the call.
fn method_call<'a>(e: Expr<'a>, names: &[&str]) -> Option<(Expr<'a>, Call<'a>)> {
    let call = e.as_call()?;
    let (object, name, _) = call.callee().as_dot()?;
    name.name().is_any(names).then_some((object, call))
}

fn is_expression_statement(e: Expr) -> bool {
    matches!(e.parent(), Node::Stmt(it) if it.tag() == StmtTag::Expr && !it.is_wrapper())
}

/// The arrow function whose expression body is `e`.
fn arrow_with_body(e: Expr<'_>) -> Option<Func<'_>> {
    (e.parent().as_func()).filter(|it| matches!(it.body(), FnBody::Expr(body) if body == e))
}

/// The `list.forEach(func)` call.
fn for_each_call_of(func: Func<'_>) -> Option<Expr<'_>> {
    let callback = func.owner().as_expr()?;
    let call = callback.parent().as_expr()?;
    (method_call(call, &["forEach"])?.1.args().first() == Some(callback)).then_some(call)
}

/// True if nothing gets the value of `e`: it's a statement, or what a `forEach` callback returns.
pub(crate) fn is_discarded(e: Expr) -> bool {
    is_expression_statement(e) || arrow_with_body(e).and_then(for_each_call_of).is_some()
}

/// `Promise.all(argument)`
fn is_combined<'a>(call: Expr<'a>, argument: Expr<'a>) -> bool {
    method_call(call, &["all", "allSettled", "any", "race"]).is_some_and(|(object, it)| {
        object.is_ident("Promise") && it.args().first() == Some(argument)
    })
}

/// The promise that depends on `promise`: with the `.then(..)` calls after it and the `Promise.all([..])` around it.
pub(crate) fn outermost_promise(promise: Expr<'_>) -> Expr<'_> {
    let mut at = promise;
    while let Some(parent) = at.parent().as_expr() {
        let outer = parent.parent().as_expr();
        at = match (parent.tag(), outer) {
            (ExprTag::As | ExprTag::Satisfies | ExprTag::NonNull, _) => parent,
            (ExprTag::Dot, Some(outer))
                if method_call(outer, &["then", "catch", "finally"])
                    .is_some_and(|it| it.0 == at) =>
            {
                outer
            }
            (ExprTag::Array, Some(outer)) if is_combined(outer, parent) => outer,
            (ExprTag::Call, _) if is_combined(parent, at) => parent,
            _ => break,
        };
    }
    at
}

fn is_awaited(e: Expr) -> bool {
    matches!(e.parent(), Node::Expr(it) if it.tag() == ExprTag::Await)
}

fn is_returned(e: Expr) -> bool {
    match e.parent() {
        Node::Stmt(parent) => parent.tag() == StmtTag::Return,
        _ => arrow_with_body(e).is_some() && !is_discarded(e),
    }
}

/// True if `e` is returned from a `try` block or from the scope of a `using`, which end before it settles.
pub(crate) fn is_returned_before_cleanup<'a>(e: Expr<'a>) -> bool {
    let has_using = |statements: Option<List<'a, Stmt<'a>>>| {
        let mut variables = statements.into_iter().flatten().filter_map(Stmt::as_var);
        variables.any(|it| {
            it.iter()
                .any(|it| matches!(it.var_kind(), VarKind::Using | VarKind::AwaitUsing))
        })
    };
    if !is_returned(e) {
        return false;
    }
    for ancestor in Node::Expr(e).ancestors() {
        match ancestor {
            Node::Func(func) => return has_using(func.body_statements()),
            Node::Stmt(it) if it.tag() == StmtTag::Try || has_using(it.as_block()) => return true,
            _ => {}
        }
    }
    false
}

/// True if `func` can return before it's done. An `async` function that can't ran to its end before Bun 1.5.
fn has_await(func: Func) -> bool {
    let file = func.file();
    let awaits = file.exprs_of_kind(ExprTag::Await).map(Node::Expr);
    let loops =
        (file.stmts_of_kind(StmtTag::ForOf)).filter(|it| it.as_for_of().is_some_and(|it| it.3));
    let disposals = file.stmts_of_kind(StmtTag::Var).filter(|it| {
        (it.as_var().and_then(List::first)).is_some_and(|it| it.var_kind() == VarKind::AwaitUsing)
    });
    (awaits.chain(loops.chain(disposals).map(Node::Stmt)))
        .any(|it| it.enclosing_function() == Some(func))
}

/// True if `for..of` visits what `e.forEach()` visits. For a `Map`, a stream or an array with holes it doesn't.
fn is_list(mut e: Expr) -> bool {
    const KEEP_ARRAYS: [&str; 10] = [
        "concat",
        "filter",
        "flat",
        "flatMap",
        "map",
        "reverse",
        "slice",
        "sort",
        "toReversed",
        "toSorted",
    ];
    // A variable can be initialized with itself.
    for _ in 0..16 {
        e = e.skip_type_wrappers();
        let inner = match e.tag() {
            ExprTag::Ident => get_const_variable_initializer(e),
            _ => method_call(e, &KEEP_ARRAYS).map(|it| it.0),
        };
        match inner {
            Some(inner) => e = inner,
            None => break,
        }
    }
    let is_static = |class: &str, names: &[&str]| {
        method_call(e, names).is_some_and(|it| it.0.is_ident(class) && is_global_reference(it.0))
    };
    let is_array_parameter = || match e.symbol().and_then(|it| it.declarations().next()) {
        Some(Declaration::Param(pat)) => matches!(pat.parent(), Node::Param(it)
            if it.is_rest() || it.ty().is_some_and(|it| it.tag() == TypeTag::Array)),
        _ => false,
    };
    (e.as_array()).is_some_and(|it| !it.iter().any(Expr::is_missing))
        || method_call(e, &["split"]).is_some()
        || is_static("Object", &["entries", "keys", "values"])
        || is_static("Array", &["from", "of"])
        || is_array_parameter()
}

/// The edits that await `promise` so that the test it runs in waits for it: the function around it becomes `async`, the
/// calls to that function in this file are awaited as well, and a `forEach` becomes a `for..of`. `None` if something in
/// between would drop the promise, because then a failed assertion fails a later test, or none.
pub(crate) fn await_fixes<'a>(fixer: Fixer<'a>, promise: Expr<'a>) -> Option<Vec<Fix>> {
    let mut awaits = Awaits {
        fixer,
        fixes: Vec::new(),
        pending: Vec::new(),
        awaited: IdSet::new(),
        functions: IdSet::new(),
    };
    awaits.add(promise);
    while let Some(node) = awaits.pending.pop() {
        awaits.allow_await_at(node)?;
    }
    Some(awaits.fixes)
}

struct Awaits<'a> {
    fixer: Fixer<'a>,
    fixes: Vec<Fix>,
    /// The places that got an `await`, and whose function hasn't been looked at.
    pending: Vec<Node<'a>>,
    awaited: IdSet<Expr<'a>>,
    functions: IdSet<Func<'a>>,
}

impl<'a> Awaits<'a> {
    fn add(&mut self, promise: Expr<'a>) {
        if self.awaited.insert(promise) {
            let fix = self.fixer.insert_before(promise.outer_span(), "await ");
            self.fixes.push(fix);
            self.pending.push(Node::Expr(promise));
        }
    }

    fn allow_await_at(&mut self, node: Node<'a>) -> Option<()> {
        for ancestor in node.ancestors() {
            match ancestor {
                Node::Func(func) if self.functions.insert(func) => return self.wait_for(func),
                Node::Func(_) => return Some(()),
                Node::Member(_) | Node::Param(_) => return None,
                Node::Stmt(it) if it.tag() == StmtTag::Module => return None,
                _ => {}
            }
        }
        let mut body = self.fixer.file().body().iter();
        body.any(|it| it.tag() == StmtTag::Import).then_some(())
    }

    /// Makes `func` async, and whatever calls it wait for it.
    fn wait_for(&mut self, func: Func<'a>) -> Option<()> {
        if func.is_generator() {
            return func.is_async().then_some(());
        }
        let e = match func.owner() {
            Node::Expr(e) => e,
            Node::Stmt(it) => return self.wait_for_named(func, func.symbol(), it.is_exported()),
            _ => return func.is_async().then_some(()),
        };
        if let Some(test) = test_or_hook_of(e) {
            return self.make_callback_async(func, &test);
        }
        if let Some(call) = for_each_call_of(func) {
            return self.make_loop(call, func);
        }
        match e.parent() {
            Node::VarDecl(it) if func.is_async() || it.ty().is_none() => {
                let is_exported = it.parent().as_stmt().is_none_or(Stmt::is_exported);
                self.wait_for_named(func, it.pat().symbol(), is_exported)
            }
            // What it's passed to, or the call of it.
            Node::Expr(call) if matches!(call.tag(), ExprTag::Call | ExprTag::New) => {
                let name = call.callee().and_then(jest::first_identifier_of_chain);
                // `const it = isCI ? test.skip : test`
                let is_alias_of_test = name.is_some_and(|it| it.is_any(&["it", "test"]));
                let promise = outermost_promise(call);
                let is_waited_for = call.tag() == ExprTag::Call
                    && !name.is_some_and(|it| it.is("describe"))
                    && (is_alias_of_test || is_awaited(promise) || is_returned(promise));
                (func.is_async() && is_waited_for).then_some(())
            }
            _ => func.is_async().then_some(()),
        }
    }

    /// The callers of a function that's already async are expected to handle its promise, so they only have to be
    /// changed where they visibly drop it.
    fn wait_for_named(
        &mut self,
        func: Func<'a>,
        symbol: Option<Symbol<'a>>,
        is_exported: bool,
    ) -> Option<()> {
        let symbol = symbol?;
        let was_async = func.is_async();
        if !was_async
            && (is_exported || symbol.declaration_count() > 1 || symbol.has_modifying_references())
        {
            return None;
        }
        let ran_to_its_end = !was_async || !has_await(func);
        for reference in symbol.references().filter(|it| !it.is_init()) {
            let e = reference.expr().filter(|it| !it.is_in_type_query());
            if let Some(test) = e.and_then(test_or_hook_of) {
                self.can_be_async(func, &test).then_some(())?;
                continue;
            }
            let call = e.and_then(|e| {
                (e.parent().as_expr()).filter(|it| it.as_call().is_some_and(|it| it.callee() == e))
            });
            let promise = call.map(|it| if was_async { outermost_promise(it) } else { it });
            match promise {
                // It may be left running on purpose, until the caller does what it waits for.
                Some(it) if is_discarded(it) && !ran_to_its_end => return None,
                Some(it) if is_discarded(it) => self.add(it),
                Some(it) if is_returned(it) => {
                    if ran_to_its_end && !self.is_waited_for_where_it_is_returned(it, was_async) {
                        self.add(it);
                    }
                }
                Some(it) if is_awaited(it) => {}
                _ if was_async => {}
                _ => return None,
            }
        }
        self.make_async(func)
    }

    fn is_waited_for_where_it_is_returned(&self, promise: Expr<'a>, was_a_promise: bool) -> bool {
        let caller = Node::Expr(promise).enclosing_function();
        let Some((caller, e)) = caller.and_then(|it| Some((it, it.owner().as_expr()?))) else {
            return false;
        };
        !is_returned_before_cleanup(promise)
            && match test_or_hook_of(e) {
                Some(test) => self.can_be_async(caller, &test),
                None => was_a_promise && !matches!(e.parent(), Node::VarDecl(_)),
            }
    }

    /// `bun test` doesn't wait for `done` if the promise that the test returns is already fulfilled. Jest rejects such
    /// a test, and it can be what runs a file without an import from `bun:test`.
    fn can_be_async(&self, func: Func<'a>, test: &ParsedGeneralJestFnCall) -> bool {
        let file = self.fixer.file();
        if func.is_async() || imports_from(file, "vitest") {
            return true;
        }
        let is_named_done = |it: &Param| {
            (it.pat().as_ident()).is_some_and(|it| it.is_any(&["done", "cb", "callback", "next"]))
        };
        let done = match takes_rows(test) {
            true => func.params().last().filter(is_named_done),
            false => func.params().first(),
        };
        done.is_none_or(|it| {
            jest::is_for(file, jest::BUN)
                && (it.pat().symbol()).is_some_and(|it| only_call_at_the_end(func, it).is_some())
        })
    }

    fn make_callback_async(
        &mut self,
        func: Func<'a>,
        test: &ParsedGeneralJestFnCall,
    ) -> Option<()> {
        self.can_be_async(func, test).then_some(())?;
        self.make_async(func)
    }

    fn make_async(&mut self, func: Func<'a>) -> Option<()> {
        if func.is_async() {
            return Some(());
        }
        let fixer = self.fixer;
        self.fixes
            .push(fixer.insert_before(func.estree_span(), "async "));
        if let Some(ty) = func.return_type()
            && !ty.as_ref().is_some_and(|it| it.0.is("Promise"))
        {
            if ty.tag() == TypeTag::Predicate {
                return None;
            }
            self.fixes
                .push(fixer.insert_before(ty.outer_span(), "Promise<"));
            self.fixes.push(fixer.insert_after(ty.outer_span(), ">"));
        }
        Some(())
    }

    /// `list.forEach(it => { .. });` becomes `for (const it of list) { .. }`.
    fn make_loop(&mut self, call: Expr<'a>, func: Func<'a>) -> Option<()> {
        let (fixer, file) = (self.fixer, self.fixer.file());
        let (list, arguments) = method_call(call, &["forEach"])?;
        let statement = call.parent().as_stmt()?;
        let item = func.params().first()?;
        let variables = func.scope()?;
        let is_var = |it: Declaration| match it.node() {
            Some(Node::VarDecl(it)) => it.var_kind() == VarKind::Var,
            _ => false,
        };
        // The loop's variables are already in scope where the list is evaluated.
        let shadows_list = || {
            (file.references_within(list.span())).any(|it| variables.get_name(it.name()).is_some())
        };
        // `forEach` reads the length once.
        let can_grow_list = || {
            (file
                .references_within(list.span())
                .filter_map(Reference::symbol))
            .any(|it| {
                let mut uses = it.references();
                uses.any(|it| func.estree_span().contains(it.span()))
            })
        };
        if !is_expression_statement(call)
            || call.is_parenthesized()
            || call.is_in_optional_chain()
            || arguments.args().len() != 1
            || !func.is_arrow()
            || func.params().len() != 1
            || item.is_rest()
            || item.default().is_some()
            || func.returns().next().is_some()
            || variables.symbols().any(|it| it.declarations().any(is_var))
            || !is_list(list)
            || shadows_list()
            || can_grow_list()
            || func.is_async() && has_await(func)
        {
            return None;
        }
        let (body, end) = match func.body() {
            FnBody::Expr(body) => (body.outer_span(), ";"),
            _ => (func.body_span()?, ""),
        };
        let mut is_assigned = false;
        item.pat().for_each_binding(&mut |it| {
            is_assigned |= it.symbol().is_some_and(Symbol::has_modifying_references);
        });
        let keyword: &[u8] = if is_assigned { b"let" } else { b"const" };
        let head = [b"for (", keyword, b" ", item.pat().text(), b" of "].concat();
        let removed = [
            list.outer_span().between(body),
            Span::after(body, statement.span().end),
        ];
        if (removed.iter()).any(|it| file.comments_in(*it).next().is_some()) {
            return None;
        }
        self.fixes.extend([
            fixer.insert_before(list.outer_span(), head),
            fixer.replace(removed[0], ") "),
            fixer.replace(removed[1], end),
        ]);
        self.pending.push(Node::Stmt(statement));
        Some(())
    }
}

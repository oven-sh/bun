//! Top-level await in a bundle that prints several modules into one file.
//!
//! ECMA-262 evaluates a module graph in two stages. `InnerModuleEvaluation` walks the graph depth first and, where it
//! leaves a module, either runs it (no top-level await, nothing asynchronous to wait for), starts it (top-level await,
//! nothing to wait for) or parks it on the modules it waits for. No promise job runs during that walk, so for the
//! first `Evaluate()` of a graph everything it computes is known at build time: which modules are asynchronous, their
//! `[[AsyncEvaluationOrder]]`, `[[PendingAsyncDependencies]]`, `[[AsyncParentModules]]` and `[[CycleRoot]]`. Then
//! `AsyncModuleExecutionFulfilled` / `Rejected` run as promise jobs and only touch the asynchronous modules.
//!
//! So the linker does the walk:
//! - a module that runs during the walk stays as it is, unwrapped, at its place in the chunk
//! - a module that is asynchronous prints at its place as `var init_x = __tlaNode(body, hasTLA, [what it waits for])`
//! - unless nobody can tell when it runs (it only declares functions, say): then it stays as it is, and its importers
//!   wait for what it would have waited for
//! - `runtime.tla.js` has the second stage
//!
//! `mark_tla_nodes` picks the files before the wrappers are made. `compute_tla_plan` fills in what each one waits for
//! once the order of the files in the chunk is known.
//!
//! The reasoning, the limits and the measurements are in `top-level-await.md`, next to this file.

use crate::mal_prelude::*;
use bun_ast::{
    E, Expr, ExprData, ExprNodeList, ImportKind, ImportRecordFlags, Loc, Ref, S, Stmt, StmtData,
};
use bun_collections::{AutoBitSet, VecExt};
use bun_core::UnwrapOrOom;

use super::find_all_imported_parts_in_js_order::LoadEffect;
use crate::js_meta::TlaShape;
use crate::options::Format;
use crate::{Chunk, Index, IndexInt, LinkerContext, WrapKind, chunk};

#[derive(Default)]
pub(crate) struct TlaNode {
    /// `[[AsyncParentModules]]` of each of these gets this file.
    pub(crate) waits_for: Vec<IndexInt>,
    /// The file is in an import cycle, and the walk leaves the cycle at a later file.
    pub(crate) is_open: bool,
    /// The walk leaves an import cycle at this file (its `[[CycleRoot]]`): the other asynchronous files of the cycle.
    pub(crate) members: Vec<IndexInt>,
    /// Of a `TlaShape::Transparent` file: it prints `var init_foo = __tlaNode(() => {}, 0, [...])` after all, so that
    /// its importers name it and not each a copy of the list.
    pub(crate) is_junction: bool,
}

/// By source index, for the files with `TlaShape::is_planned`. Empty when the chunk has none.
pub(crate) type TlaPlan = Box<[Option<Box<TlaNode>>]>;

/// Calls `each` with the files that the `import` and `export from` statements of a file name, in evaluation order.
fn for_each_static_import(
    c: &LinkerContext,
    source_index: IndexInt,
    mut each: impl FnMut(IndexInt),
) {
    let records = c.graph.ast.items_import_records()[source_index as usize].as_slice();
    let parts = c.graph.ast.items_parts()[source_index as usize].as_slice();
    for part in parts {
        for &record_id in part.import_record_indices.iter() {
            let record = &records[record_id as usize];
            if record.kind == ImportKind::Stmt
                && record.source_index.is_valid()
                && !record.flags.contains(ImportRecordFlags::IS_UNUSED)
            {
                each(record.source_index.get());
            }
        }
    }
}

/// The parser puts the `import` and `export from` statements of a file first. The index of the part behind them.
pub(crate) fn first_body_part(c: &LinkerContext, source_index: IndexInt) -> u32 {
    let parts = c.graph.ast.items_parts()[source_index as usize].as_slice();
    const _: () = assert!(bun_ast::NAMESPACE_EXPORT_PART_INDEX == 0);
    let imports = parts.iter().skip(1).take_while(|part| {
        part.stmts.slice().iter().all(|stmt| {
            matches!(
                stmt.data,
                StmtData::SImport(_) | StmtData::SExportStar(_) | StmtData::SExportFrom(_)
            )
        }) && !part.stmts.slice().is_empty()
    });
    1 + imports.count() as u32
}

/// `callee(arg)`
fn call(callee: Ref, arg: Option<Expr>, loc: Loc) -> Expr {
    Expr::init(
        E::Call {
            target: Expr::init_identifier(callee, loc),
            args: ExprNodeList::from_slice(arg.as_slice()),
            ..Default::default()
        },
        loc,
    )
}

/// `callee(init_foo)`
fn call_with_wrapper(callee: Ref, wrapper_ref: Ref, loc: Loc) -> Expr {
    call(callee, Some(Expr::init_identifier(wrapper_ref, loc)), loc)
}

fn expr_stmt(value: Expr) -> Stmt {
    Stmt::alloc(
        S::SExpr {
            value,
            ..Default::default()
        },
        value.loc,
    )
}

/// `[init_foo, init_bar]`
pub(crate) fn wrappers_of(c: &LinkerContext, files: &[IndexInt]) -> Expr {
    let wrapper_refs = c.graph.ast.items_wrapper_ref();
    let mut items = ExprNodeList::init_capacity(files.len());
    for &file in files {
        items.append_assume_capacity(Expr::init_identifier(
            wrapper_refs[file as usize],
            Loc::EMPTY,
        ));
    }
    Expr::init(
        E::Array {
            items,
            is_single_line: true,
            ..Default::default()
        },
        Loc::EMPTY,
    )
}

/// The end of a body with an `await`, when an entry point is a `TlaShape::Main`: `__tlaDone(init_foo);`
pub(crate) fn done_stmt(c: &LinkerContext, wrapper_ref: Ref) -> Stmt {
    expr_stmt(call_with_wrapper(
        c.runtime_function(b"__tlaDone"),
        wrapper_ref,
        Loc::EMPTY,
    ))
}

/// Ahead of the body of a `TlaShape::Main`: `await __tlaMain([init_foo]);` and `__tlaResume();`
pub(crate) fn main_stmts(c: &LinkerContext, node: &TlaNode) -> [Stmt; 2] {
    [
        expr_stmt(Expr::init(
            E::Await {
                value: call(
                    c.runtime_function(b"__tlaMain"),
                    Some(wrappers_of(c, &node.waits_for)),
                    Loc::EMPTY,
                ),
            },
            Loc::EMPTY,
        )),
        expr_stmt(call(c.runtime_function(b"__tlaResume"), None, Loc::EMPTY)),
    ]
}

/// `var init_foo = callee(args);`
pub(crate) fn declare_wrapper_stmt(
    arena: &bun_alloc::Arena,
    wrapper_ref: Ref,
    callee: Ref,
    args: Vec<Expr>,
) -> Stmt {
    Stmt::alloc(
        S::Local {
            decls: bun_ast::G::DeclList::from_slice(&[bun_ast::G::Decl {
                binding: bun_ast::Binding::alloc(
                    arena,
                    bun_ast::B::Identifier { r#ref: wrapper_ref },
                    Loc::EMPTY,
                ),
                value: Some(Expr::init(
                    E::Call {
                        target: Expr::init_identifier(callee, Loc::EMPTY),
                        args: Vec::move_from_list(args),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                )),
            }]),
            ..Default::default()
        },
        Loc::EMPTY,
    )
}

/// `0` or `1`
pub(crate) fn number(value: bool) -> Expr {
    Expr::init(E::Number::new(f64::from(u8::from(value))), Loc::EMPTY)
}

/// `() => { stmts }`
pub(crate) fn arrow(is_async: bool, stmts: bun_ast::StoreSlice<Stmt>) -> Expr {
    Expr::init(
        E::Arrow {
            is_async,
            body: bun_ast::G::FnBody {
                stmts,
                loc: Loc::EMPTY,
            },
            ..Default::default()
        },
        Loc::EMPTY,
    )
}

/// Behind the statements of a `TlaShape::Transparent` file that `is_junction`: `var init_foo = __tlaNode(() => {}, 0, [...]);`
pub(crate) fn junction_stmt(
    c: &LinkerContext,
    arena: &bun_alloc::Arena,
    wrapper_ref: Ref,
    node: &TlaNode,
) -> Stmt {
    declare_wrapper_stmt(
        arena,
        wrapper_ref,
        c.runtime_function(b"__tlaNode"),
        Vec::<Expr>::from_slice(&[
            arrow(false, bun_ast::StoreSlice::EMPTY),
            number(false),
            wrappers_of(c, &node.waits_for),
        ]),
    )
}

/// Whether the part only declares things: what the linker hoists out of a wrapper.
fn evaluates_nothing(part: &bun_ast::Part) -> bool {
    LoadEffect::of(part) != LoadEffect::Evaluates
        && part.stmts.slice().iter().all(|stmt| match &stmt.data {
            // `using x = 1` throws, and a pattern runs getters or an iterator.
            StmtData::SLocal(local) => {
                !local.kind.is_using()
                    && local
                        .decls
                        .slice()
                        .iter()
                        .all(|decl| matches!(decl.binding.data, bun_ast::b::B::BIdentifier(_)))
            }
            _ => true,
        })
}

/// Finds the files that reach a top-level await and can still run during the walk, where they print, because nobody
/// can tell the difference: every statement either declares something, or has no side effects and reads, where it
/// stands (not inside a function that it defines), only bindings that have their final value by then.
struct RunsUnnoticed<'a, 'c> {
    c: &'a LinkerContext<'c>,
    reaches_tla: &'a [bool],
    /// In an import cycle, or imports itself.
    is_in_cycle: &'a [bool],
    /// The answers so far. A file is asked about after the files that it imports.
    files: Vec<bool>,
}

/// A statement of a file, by its part.
#[derive(Clone, Copy)]
struct Place {
    file: IndexInt,
    part: u32,
}

impl RunsUnnoticed<'_, '_> {
    /// Literals nested deeper than this stay in a wrapper.
    const MAX_DEPTH: u32 = 32;

    fn file(&self, file: IndexInt) -> bool {
        let c = self.c;
        // Not in an import cycle: the file that the walk leaves last stands for the others, and the order in which
        // the files of a cycle run is not the order of their imports.
        c.graph.meta.items_flags()[file as usize].wrap == WrapKind::None
            && !c.graph.files.items_entry_point_kind()[file as usize].is_entry_point()
            && c.parse_graph().ast.items_top_level_await_keyword()[file as usize].is_empty()
            && !self.is_in_cycle[file as usize]
            && c.graph.ast.items_parts()[file as usize]
                .as_slice()
                .iter()
                .enumerate()
                .all(|(part_index, part)| {
                    let at = Place {
                        file,
                        part: part_index as u32,
                    };
                    evaluates_nothing(part)
                        || (part.can_be_removed_if_unused
                            && part.stmts.slice().iter().all(|stmt| self.stmt(at, stmt)))
                })
    }

    fn stmt(&self, at: Place, stmt: &Stmt) -> bool {
        match &stmt.data {
            StmtData::SLocal(local) => {
                !local.kind.is_using()
                    && local.decls.slice().iter().all(|decl| {
                        matches!(decl.binding.data, bun_ast::b::B::BIdentifier(_))
                            && decl
                                .value
                                .as_ref()
                                .is_none_or(|value| self.expr(at, value, 0))
                    })
            }
            StmtData::SClass(class) => self.class(at, &class.class, 0),
            StmtData::SExportDefault(default) => match &default.value {
                bun_ast::StmtOrExpr::Expr(value) => self.expr(at, value, 0),
                bun_ast::StmtOrExpr::Stmt(stmt) => self.stmt(at, stmt),
            },
            StmtData::SFunction(_) | StmtData::SExportClause(_) | StmtData::SEmpty(_) => true,
            _ => false,
        }
    }

    /// The parser found that the expression has no side effects. This looks for what it reads, and only takes the
    /// kinds of expressions that cannot throw whatever they read.
    fn expr(&self, at: Place, expr: &Expr, depth: u32) -> bool {
        if expr.can_be_moved() {
            return true;
        }
        if depth > Self::MAX_DEPTH {
            return false;
        }
        match &expr.data {
            ExprData::EIdentifier(id) => self.read(at, id.ref_, false),
            ExprData::EImportIdentifier(id) => self.read(at, id.ref_, false),
            ExprData::EClass(class) => self.class(at, class, depth + 1),
            ExprData::EArray(array) => array
                .items
                .slice()
                .iter()
                .all(|item| self.expr(at, item, depth + 1)),
            ExprData::EObject(object) => object.properties.slice().iter().all(|property| {
                property.kind != bun_ast::G::PropertyKind::Spread
                    // A computed key is turned into a string.
                    && property.key.as_ref().is_none_or(Expr::can_be_moved)
                    && [property.value, property.initializer]
                        .iter()
                        .flatten()
                        .all(|value| self.expr(at, value, depth + 1))
            }),
            _ => false,
        }
    }

    fn class(&self, at: Place, class: &bun_ast::G::Class, depth: u32) -> bool {
        use bun_ast::G::PropertyKind;
        use bun_ast::flags::Property;
        if class.has_decorators {
            return false;
        }
        let extends = match class.extends.as_ref().map(|base| &base.data) {
            None => true,
            Some(ExprData::EIdentifier(id)) => self.read(at, id.ref_, true),
            Some(ExprData::EImportIdentifier(id)) => self.read(at, id.ref_, true),
            Some(_) => false,
        };
        extends
            && class.properties.slice().iter().all(|property| {
                property.kind != PropertyKind::ClassStaticBlock
                    && (!property.flags.contains(Property::IsComputed)
                        || property.key.as_ref().is_some_and(Expr::can_be_moved))
                    // Methods and the fields of instances run later.
                    && (!property.flags.contains(Property::IsStatic)
                        || [property.value, property.initializer]
                            .iter()
                            .flatten()
                            .all(|value| self.expr(at, value, depth)))
            })
    }

    /// `is_base`: the statement is `class A extends B`. That throws unless `B` is a constructor, and it reads
    /// `B.prototype`, which anybody can replace at any time unless `B` is a class.
    fn read(&self, at: Place, ref_: Ref, is_base: bool) -> bool {
        let c = self.c;
        let (declared_in, ref_) =
            match c.graph.meta.items_imports_to_bind()[at.file as usize].get(&ref_) {
                Some(import) => (import.data.source_index.get(), import.data.import_ref),
                None => (at.file, ref_),
            };
        let Some(symbol) = c.graph.symbols.get_const(ref_) else {
            return false;
        };
        use bun_ast::symbol::Kind;
        if symbol.has_been_assigned_to()
            || symbol.namespace_alias.is_some()
            || !matches!(
                symbol.kind,
                Kind::Class | Kind::HoistedFunction | Kind::Constant | Kind::Hoisted | Kind::Other
            )
            || c.graph.ast.items_css()[declared_in as usize].is_some()
        {
            return false;
        }
        let parts = c.graph.ast.items_parts()[declared_in as usize].as_slice();
        let declared_by = c.top_level_symbols_to_parts(declared_in, ref_);
        if declared_by.is_empty() {
            return false;
        }
        if is_base
            && symbol.kind != Kind::Class
            && !declared_by.iter().all(|&part| {
                parts[part as usize].stmts.slice().iter().any(|stmt| {
                    matches!(&stmt.data, StmtData::SLocal(local) if local.decls.slice().iter().any(|decl| {
                        matches!(decl.binding.data, bun_ast::b::B::BIdentifier(id) if id.r#ref == ref_)
                            && matches!(decl.value.map(|value| value.data), Some(ExprData::EClass(_)))
                    }))
                })
            })
        {
            return false;
        }
        // The statements of one file keep their order.
        if declared_in == at.file {
            return !is_base || declared_by.iter().all(|&part| part < at.part);
        }
        // A file that reaches no top-level await has run, unless it is a wrapper that something has to call.
        if !self.reaches_tla[declared_in as usize] {
            return c.graph.meta.items_flags()[declared_in as usize].wrap == WrapKind::None;
        }
        self.files[declared_in as usize]
            // The file runs later, in a wrapper. What the linker hoists out of the wrapper is there already.
            || (!self.is_in_cycle[declared_in as usize]
                && declared_by
                    .iter()
                    .all(|&part| evaluates_nothing(&parts[part as usize])))
    }
}

/// Calls `each` with the files of every strongly connected component of the graph that `imports_of` spans over
/// `files` (Tarjan, explicit stack). A file that is in no import cycle is a component of its own.
fn for_each_component(
    files: impl Iterator<Item = IndexInt>,
    files_len: usize,
    imports_of: impl Fn(IndexInt) -> Vec<IndexInt>,
    mut each: impl FnMut(&[IndexInt]),
) {
    let mut index_of = vec![u32::MAX; files_len];
    let mut low = vec![0u32; files_len];
    let mut on_stack = vec![false; files_len];
    let mut component: Vec<IndexInt> = Vec::new();
    let mut next_index = 0u32;
    let mut frames: Vec<(IndexInt, Vec<IndexInt>, usize)> = Vec::new();
    for start in files {
        if index_of[start as usize] != u32::MAX {
            continue;
        }
        frames.push((start, imports_of(start), 0));
        index_of[start as usize] = next_index;
        low[start as usize] = next_index;
        next_index += 1;
        component.push(start);
        on_stack[start as usize] = true;
        while let Some((file, imports, next)) = frames.last_mut() {
            let file = *file;
            if let Some(&other) = imports.get(*next) {
                *next += 1;
                if index_of[other as usize] == u32::MAX {
                    index_of[other as usize] = next_index;
                    low[other as usize] = next_index;
                    next_index += 1;
                    component.push(other);
                    on_stack[other as usize] = true;
                    frames.push((other, imports_of(other), 0));
                } else if on_stack[other as usize] {
                    low[file as usize] = low[file as usize].min(index_of[other as usize]);
                }
                continue;
            }
            frames.pop();
            if let Some((parent, _, _)) = frames.last() {
                low[*parent as usize] = low[*parent as usize].min(low[file as usize]);
            }
            if low[file as usize] == index_of[file as usize] {
                let start_of_component = component
                    .iter()
                    .rposition(|&member| member == file)
                    .unwrap();
                for &member in &component[start_of_component..] {
                    on_stack[member as usize] = false;
                }
                each(&component[start_of_component..]);
                component.truncate(start_of_component);
            }
        }
    }
}

/// Whether evaluating the expression gets to an `await` whatever happens, unless something throws first.
fn expr_surely_suspends(mut expr: &Expr, depth: u32) -> bool {
    use bun_ast::{AssignTarget, OpCode};
    if depth > 32 {
        return false;
    }
    let any = |exprs: &[Expr]| {
        exprs
            .iter()
            .any(|expr| expr_surely_suspends(expr, depth + 1))
    };
    // `a + b + c + ...` nests to the left, as deep as it is long.
    loop {
        expr = match &expr.data {
            ExprData::EAwait(_) => return true,
            ExprData::EDot(dot) if dot.optional_chain.is_none() => &dot.target,
            ExprData::EIndex(index) if index.optional_chain.is_none() => {
                if expr_surely_suspends(&index.index, depth + 1) {
                    return true;
                }
                &index.target
            }
            ExprData::ECall(call) if call.optional_chain.is_none() => {
                if any(call.args.slice()) {
                    return true;
                }
                &call.target
            }
            ExprData::ENew(new) => {
                if any(new.args.slice()) {
                    return true;
                }
                &new.target
            }
            ExprData::EUnary(unary) => &unary.value,
            ExprData::ESpread(spread) => &spread.value,
            ExprData::EArray(array) => return any(array.items.slice()),
            ExprData::EIf(conditional) => &conditional.test,
            ExprData::EBinary(binary) => match binary.op {
                OpCode::BinLogicalAnd | OpCode::BinLogicalOr | OpCode::BinNullishCoalescing => {
                    &binary.left
                }
                OpCode::BinLogicalAndAssign
                | OpCode::BinLogicalOrAssign
                | OpCode::BinNullishCoalescingAssign => return false,
                // The target can be a pattern with defaults.
                op if op.binary_assign_target() != AssignTarget::None => &binary.right,
                _ => {
                    if expr_surely_suspends(&binary.right, depth + 1) {
                        return true;
                    }
                    &binary.left
                }
            },
            _ => return false,
        };
    }
}

/// Whether the body of the file gets to an `await` whatever happens, unless it throws first.
fn surely_suspends(c: &LinkerContext, source_index: IndexInt) -> bool {
    c.graph.ast.items_parts()[source_index as usize]
        .as_slice()
        .iter()
        .flat_map(|part| part.stmts.slice())
        .any(|stmt| match &stmt.data {
            StmtData::SExpr(expr) => expr_surely_suspends(&expr.value, 0),
            StmtData::SLocal(local) => local.decls.slice().iter().any(|decl| {
                decl.value
                    .as_ref()
                    .is_some_and(|value| expr_surely_suspends(value, 0))
            }),
            StmtData::SExportDefault(default) => match &default.value {
                bun_ast::StmtOrExpr::Expr(value) => expr_surely_suspends(value, 0),
                bun_ast::StmtOrExpr::Stmt(_) => false,
            },
            StmtData::SForOf(for_of) => for_of.is_await,
            _ => false,
        })
}

/// What an `import` statement that names a `__tlaModule` does: `__tlaVisit(init_foo);` among the `import` statements
/// of another `__tlaModule`, `__tlaTop(init_foo);` anywhere else.
pub(crate) fn visit_stmt(
    c: &LinkerContext,
    importer_flags: crate::js_meta::Flags,
    wrapper_ref: Ref,
    loc: Loc,
) -> Stmt {
    let callee = if importer_flags.tla == TlaShape::Module {
        c.runtime_function(b"__tlaVisit")
    } else {
        c.runtime_function(b"__tlaTop")
    };
    expr_stmt(call_with_wrapper(callee, wrapper_ref, loc))
}

/// The end of the chunk of an entry point that is a `__tlaNode` or a `__tlaModule`: `await __tlaWait(init_foo);` or
/// `await __tlaEvaluate(init_foo);`
pub(crate) fn entry_point_tail_stmt(
    c: &LinkerContext,
    flags: crate::js_meta::Flags,
    wrapper_ref: Ref,
) -> Stmt {
    let callee = if flags.tla == TlaShape::Node {
        c.runtime_function(b"__tlaWait")
    } else {
        c.runtime_function(b"__tlaEvaluate")
    };
    expr_stmt(Expr::init(
        E::Await {
            value: call_with_wrapper(callee, wrapper_ref, Loc::EMPTY),
        },
        Loc::EMPTY,
    ))
}

/// Runs after the wrappers of `require()` and `import()` have spread to their dependencies and every file has its
/// `imports_to_bind`, and before `create_wrapper_for_file`.
pub(crate) fn mark_tla_nodes(c: &mut LinkerContext, reachable: &[Index]) {
    if c.options.output_format != Format::Esm || c.graph.code_splitting || c.dev_server.is_some() {
        return;
    }
    let tla_keywords = c.parse_graph().ast.items_top_level_await_keyword();
    if reachable
        .iter()
        .all(|source_index| tla_keywords[source_index.get() as usize].is_empty())
    {
        return;
    }
    let files_len = c.graph.files.len();
    let ast_len = c.graph.ast.items_import_records().len();
    let is_js =
        |c: &LinkerContext, id: usize| id < ast_len && c.graph.ast.items_css()[id].is_none();

    // A file reaches a top-level await through `import` statements: a fixed point, because of import cycles.
    let mut reaches_tla = vec![false; files_len];
    let mut importers: Vec<Vec<IndexInt>> = vec![Vec::new(); files_len];
    let mut queue: Vec<IndexInt> = Vec::new();
    for source_index in reachable {
        let id = source_index.get() as usize;
        if !is_js(c, id) {
            continue;
        }
        if !c.parse_graph().ast.items_top_level_await_keyword()[id].is_empty() {
            reaches_tla[id] = true;
            queue.push(id as IndexInt);
        }
        for_each_static_import(c, id as IndexInt, |other| {
            importers[other as usize].push(id as IndexInt)
        });
    }
    while let Some(id) = queue.pop() {
        for &importer in &importers[id as usize] {
            if !core::mem::replace(&mut reaches_tla[importer as usize], true) {
                queue.push(importer);
            }
        }
    }

    // A file with `import` statements that prints as CommonJS cannot wait.
    let flags = c.graph.meta.items_flags();
    if reachable.iter().any(|source_index| {
        reaches_tla[source_index.get() as usize]
            && flags[source_index.get() as usize].wrap == WrapKind::Cjs
    }) {
        return;
    }

    let mut is_in_cycle = vec![false; files_len];
    // Every file behind the files that it imports.
    let mut imports_first: Vec<IndexInt> = Vec::new();
    for_each_component(
        reachable
            .iter()
            .map(|source_index| source_index.get())
            .filter(|&id| reaches_tla[id as usize]),
        files_len,
        |id| {
            let mut imports: Vec<IndexInt> = Vec::new();
            for_each_static_import(c, id, |other| {
                if reaches_tla[other as usize] {
                    imports.push(other);
                }
            });
            imports
        },
        |members| {
            for &member in members {
                is_in_cycle[member as usize] =
                    members.len() > 1 || importers[member as usize].contains(&member);
            }
            imports_first.extend_from_slice(members);
        },
    );

    let runs_unnoticed: Vec<bool> = {
        let mut analysis = RunsUnnoticed {
            c,
            reaches_tla: &reaches_tla,
            is_in_cycle: &is_in_cycle,
            files: vec![false; files_len],
        };
        for &id in &imports_first {
            analysis.files[id as usize] = analysis.file(id);
        }
        analysis.files
    };

    for source_index in reachable {
        let id = source_index.get() as usize;
        if !reaches_tla[id] {
            continue;
        }
        c.graph.meta.items_flags_mut()[id].is_async_or_has_async_dependency = true;
        c.graph.meta.items_flags_mut()[id].is_in_tla_cycle = is_in_cycle[id];
        // The parser makes no wrapper symbol for a file that evaluates nothing. Others still wait for it.
        if !c.graph.ast.items_wrapper_ref()[id].is_valid() {
            c.graph.ast.items_wrapper_ref_mut()[id] =
                c.graph
                    .generate_new_symbol(id as IndexInt, bun_ast::symbol::Kind::Other, b"init_");
        }
        // A file that `import()` reaches runs when it is called, not where it prints.
        if c.graph.meta.items_flags()[id].wrap == WrapKind::Esm {
            c.graph.meta.items_flags_mut()[id].tla = TlaShape::Module;
            continue;
        }
        // An entry point that waits for nothing, and that nothing waits for, is the chunk's own top level.
        if c.graph.files.items_entry_point_kind()[id].is_entry_point() && importers[id].is_empty() {
            let mut waits = false;
            for_each_static_import(c, id as IndexInt, |other| {
                waits |= reaches_tla[other as usize]
            });
            if !waits {
                continue;
            }
        }
        if runs_unnoticed[id] {
            c.graph.meta.items_flags_mut()[id].tla = TlaShape::Transparent;
            continue;
        }
        let flags = &mut c.graph.meta.items_flags_mut()[id];
        flags.wrap = WrapKind::Esm;
        flags.tla = TlaShape::Node;
    }

    // An entry point waits for every asynchronous file of its chunk, so it runs last, in the promise job in which the
    // last body with an `await` ends. That lets it stay on the chunk's top level (`__tlaMain` in runtime.tla.js), if
    // - nothing imports it,
    // - no file is a `__tlaModule`, which can get importers later that are numbered after the entry point, and
    // - that job cannot be queued before the top level has parked: some body is certain to suspend.
    let flags = c.graph.meta.items_flags();
    if reachable
        .iter()
        .any(|source_index| flags[source_index.get() as usize].tla == TlaShape::Module)
    {
        return;
    }
    for source_index in reachable {
        let id = source_index.get();
        if c.graph.meta.items_flags()[id as usize].tla != TlaShape::Node
            || !c.graph.files.items_entry_point_kind()[id as usize].is_entry_point()
            || !importers[id as usize].is_empty()
        {
            continue;
        }
        let mut seen = vec![false; files_len];
        let mut stack = vec![id];
        let mut suspends = false;
        while let Some(file) = stack.pop() {
            suspends = suspends || (file != id && surely_suspends(c, file));
            for_each_static_import(c, file, |other| {
                if reaches_tla[other as usize]
                    && !core::mem::replace(&mut seen[other as usize], true)
                {
                    stack.push(other);
                }
            });
        }
        if suspends {
            let flags = &mut c.graph.meta.items_flags_mut()[id as usize];
            flags.wrap = WrapKind::None;
            flags.tla = TlaShape::Main;
            c.has_tla_main = true;
        }
    }
}

/// 2 MB of bit sets.
const MAX_FILES_FOR_SETS: usize = 4096;
/// A `TlaShape::Transparent` file hands on a longer list than this only if a single list gets it. That keeps the size
/// of the output linear in the number of `import` statements.
const MAX_NAMES_TO_COPY: usize = 2;

/// Runs once `files_in_chunk_order` is the order in which the walk from the entry point leaves the files.
pub(crate) fn compute_tla_plan(c: &LinkerContext, chunk: &mut Chunk) {
    let chunk::Content::Javascript(js) = &mut chunk.content else {
        return;
    };
    let flags = c.graph.meta.items_flags();
    let is_node = |file: IndexInt| flags[file as usize].tla.is_planned();
    if !js.files_in_chunk_order.iter().any(|&file| is_node(file)) {
        return;
    }
    let files_len = c.graph.files.len();
    let tla_keywords = c.parse_graph().ast.items_top_level_await_keyword();

    let mut position = vec![u32::MAX; files_len];
    let mut is_module_in_chunk = vec![false; files_len];
    let mut positions_len = 0usize;
    for &file in js.files_in_chunk_order.iter() {
        if is_node(file) {
            position[file as usize] = positions_len as u32;
            positions_len += 1;
        }
        is_module_in_chunk[file as usize] = flags[file as usize].tla == TlaShape::Module;
    }
    let imports_of = |file: IndexInt| {
        let mut imports: Vec<IndexInt> = Vec::new();
        for_each_static_import(c, file, |other| {
            if position[other as usize] != u32::MAX {
                imports.push(other);
            }
        });
        imports
    };

    // `root_of[file]`: the file of its import cycle that the walk leaves last, which is the one it entered first.
    let mut root_of = vec![u32::MAX; files_len];
    for_each_component(
        js.files_in_chunk_order
            .iter()
            .copied()
            .filter(|&file| position[file as usize] != u32::MAX),
        files_len,
        imports_of,
        |members| {
            let root = *members
                .iter()
                .max_by_key(|&&member| position[member as usize])
                .unwrap();
            for &member in members {
                root_of[member as usize] = root;
            }
        },
    );

    // How many lists get a copy of what a `Transparent` file waits for, if it hands that on: one for each file that prints
    // a list and imports it, directly or through other `Transparent` files. Without the sets, one for each importer.
    let has_sets = positions_len <= MAX_FILES_FOR_SETS;
    let mut copies = vec![0usize; files_len];
    let mut printers: Vec<Option<AutoBitSet>> = Vec::new();
    printers.resize_with(if has_sets { positions_len } else { 0 }, || None);
    for &file in js.files_in_chunk_order.iter().rev() {
        let at = position[file as usize] as usize;
        if at == u32::MAX as usize {
            continue;
        }
        let is_transparent = |file: IndexInt| flags[file as usize].tla == TlaShape::Transparent;
        let own = if has_sets { printers[at].take() } else { None };
        if let Some(own) = &own {
            copies[file as usize] = own.count();
        }
        for other in imports_of(file) {
            if !is_transparent(other) {
                continue;
            }
            if !has_sets {
                copies[other as usize] += 1;
                continue;
            }
            let set = printers[position[other as usize] as usize]
                .get_or_insert_with(|| AutoBitSet::init_empty(positions_len).unwrap_or_oom());
            match &own {
                Some(own) if is_transparent(file) => set.set_union(own),
                _ if is_transparent(file) => {}
                _ => set.set(at),
            }
        }
    }

    let mut plan: Vec<Option<Box<TlaNode>>> = Vec::new();
    plan.resize_with(files_len, || None);
    let mut is_async = vec![false; files_len];
    // `waits[position]`: the positions of everything that the file waits for, directly or not. A file need not name what
    // another file that it names waits for already. The sets take the square of the number of files, so a chunk with
    // very many of them goes without.
    let mut waits: Vec<AutoBitSet> = Vec::new();
    if has_sets {
        waits.resize_with(positions_len, || AutoBitSet::init_empty(0).unwrap_or_oom());
    }
    for &file in js.files_in_chunk_order.iter() {
        if position[file as usize] == u32::MAX {
            continue;
        }
        let mut node = Box::<TlaNode>::default();
        // Whether a `__tlaModule` is still running is only known at run time.
        for_each_static_import(c, file, |other| {
            if is_module_in_chunk[other as usize] && !node.waits_for.contains(&other) {
                node.waits_for.push(other);
            }
        });
        for other in imports_of(file) {
            // Inside a cycle that the walk has not left, a file waits for the files that the walk has left, and
            // not for the ones that it is still in. From outside, it waits for the whole cycle.
            let target = if root_of[other as usize] != root_of[file as usize] {
                root_of[other as usize]
            } else if position[other as usize] < position[file as usize] {
                other
            } else {
                continue;
            };
            if !is_async[target as usize] {
                continue;
            }
            let through = match plan[target as usize].as_deref() {
                Some(node)
                    if flags[target as usize].tla == TlaShape::Transparent && !node.is_junction =>
                {
                    node.waits_for.as_slice()
                }
                _ => core::slice::from_ref(&target),
            };
            for &target in through {
                if !node.waits_for.contains(&target) {
                    node.waits_for.push(target);
                }
            }
        }
        if !waits.is_empty() {
            let mut all = AutoBitSet::init_empty(positions_len).unwrap_or_oom();
            // Last one first: a file only waits for files that the walk has left before it.
            let mut latest_first: Vec<IndexInt> = node
                .waits_for
                .iter()
                .copied()
                .filter(|&other| position[other as usize] != u32::MAX)
                .collect();
            latest_first
                .sort_unstable_by_key(|&other| core::cmp::Reverse(position[other as usize]));
            for other in latest_first {
                let at = position[other as usize] as usize;
                if all.is_set(at) {
                    node.waits_for.retain(|&named| named != other);
                } else {
                    all.set(at);
                    all.set_union(&waits[at]);
                }
            }
            waits[position[file as usize] as usize] = all;
        }
        is_async[file as usize] =
            !tla_keywords[file as usize].is_empty() || !node.waits_for.is_empty();
        node.is_open = root_of[file as usize] != file;
        // Each importer names either the file or what the file waits for.
        node.is_junction = flags[file as usize].tla == TlaShape::Transparent
            && node.waits_for.len() > MAX_NAMES_TO_COPY
            && copies[file as usize] > 1;
        plan[file as usize] = Some(node);
    }
    for &file in js.files_in_chunk_order.iter() {
        let root = root_of[file as usize];
        if root != u32::MAX && root != file && is_async[file as usize] {
            plan[root as usize].as_mut().unwrap().members.push(file);
        }
    }
    js.tla_plan = plan.into_boxed_slice();
}

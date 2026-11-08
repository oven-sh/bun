//! Scopes a top-level `using` to its module and keeps its binding readable outside. See README.md.

use crate::mal_prelude::*;
use bun_alloc::Arena as Bump;
use bun_ast::symbol;
use bun_ast::{B, Binding, E, Expr, G, Loc, PartTag, Ref, S, Stmt, StmtData, StoreRef};
use bun_collections::{AutoBitSet, HashMap, VecExt};

use crate::bundled_ast::Flags as AstFlags;
use crate::chunk::{Content, JavaScriptChunk};
use crate::linker_context_mod::debug;
use crate::options::Format;
use crate::{Chunk, IndexInt, LinkerContext, Part, PartRange, WrapKind};

/// A top-level `using` binding read outside its scope, to the symbol its declaration binds.
pub(crate) type ScopedUsingBindings = HashMap<Ref, Ref>;

const NO_PART: u32 = u32::MAX;

fn is_using_declaration(stmt: &Stmt) -> bool {
    matches!(&stmt.data, StmtData::SLocal(local) if local.kind.is_using())
}

/// Does `stmt` stay at chunk scope when it follows the first `using` of an unwrapped file?
fn leaves_block(stmt: &Stmt) -> bool {
    match &stmt.data {
        // A function, or a class that runs no code, has its value before any statement runs.
        StmtData::SFunction(_) => true,
        StmtData::SClass(class) => class.class.can_be_moved(),
        // Not a statement of a block.
        StmtData::SImport(_) | StmtData::SExportStar(_) => true,
        _ => false,
    }
}

/// Does the `__esm` hoist loop print `stmt`, or a value in it, outside the closure?
fn leaves_esm_closure(stmt: &Stmt) -> bool {
    match &stmt.data {
        StmtData::SFunction(_) => true,
        StmtData::SClass(class) => class.class.can_be_moved(),
        StmtData::SLocal(local) => local
            .decls
            .slice()
            .iter()
            .any(|decl| local.value_can_leave_esm_wrapper(decl)),
        StmtData::SExportDefault(default) => default.can_be_moved(),
        _ => false,
    }
}

/// What the step knows about one file.
#[derive(Clone, Copy)]
struct FileState {
    /// The first live part that declares a top-level `using`, if the file is unwrapped.
    using_part: u32,
    /// The last part range of the file in the chunk at hand.
    last_range: u32,
    /// A chunk prints the file with a block.
    has_block: bool,
    /// Where the symbols of the file start in the list of them, and how many there are.
    symbols: (u32, u32),
}

pub(crate) fn scope_top_level_using(
    c: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), bun_alloc::AllocError> {
    c.scoped_using_bindings.clear();
    if c.options.output_format == Format::InternalBakeDev {
        return Ok(());
    }
    let ast_flags = c.graph.ast.items_flags();
    let files_with_using: Vec<IndexInt> = c
        .graph
        .reachable_files
        .iter()
        .map(|file| file.get())
        .filter(|&file| {
            ast_flags
                .get(file as usize)
                .is_some_and(|flags| flags.contains(AstFlags::HAS_TOP_LEVEL_USING))
        })
        .collect();
    if files_with_using.is_empty() {
        return Ok(());
    }

    let wraps = c.graph.meta.items_flags();
    let mut files = vec![
        FileState {
            using_part: NO_PART,
            last_range: 0,
            has_block: false,
            symbols: (0, 0),
        };
        ast_flags.len()
    ];
    let mut blocks = 0;
    // A library build writes typed output from the declarations as written: no block.
    if !c.options.is_library {
        for &file in &files_with_using {
            if wraps[file as usize].wrap == WrapKind::None {
                files[file as usize].using_part = first_using_part(c, file);
            }
        }
        for chunk in chunks.iter_mut() {
            if let Content::Javascript(js) = &mut chunk.content {
                block_files_of_chunk(js, &mut files);
                blocks += js.scoped_using_files.len();
            }
        }
    }

    let mut symbols: Vec<Ref> = Vec::new();
    let mut read_outside: Vec<Ref> = Vec::new();
    for &file in &files_with_using {
        read_outside.clear();
        match c.graph.meta.items_flags()[file as usize].wrap {
            WrapKind::Esm => using_bindings_read_outside_closure(c, file, &mut read_outside),
            // Every binding: a part does not always record what its own statements read.
            WrapKind::None if files[file as usize].has_block => {
                top_level_using_bindings(c, file, &mut read_outside)
            }
            // No block, or a `__commonJS` closure that holds every statement: prints as it did.
            WrapKind::None | WrapKind::Cjs => continue,
        }
        files[file as usize].symbols = (symbols.len() as u32, read_outside.len() as u32);
        for &binding in &read_outside {
            let name = c
                .graph
                .symbols
                .get_const(binding)
                .expect("a declared binding has a symbol")
                .original_name;
            let inner = c
                .graph
                .generate_new_symbol(file, symbol::Kind::Constant, name.slice());
            c.scoped_using_bindings.put(binding, inner)?;
            symbols.push(inner);
        }
    }
    debug!(
        "scope_top_level_using: {} blocks, {} symbols",
        blocks,
        symbols.len()
    );
    if symbols.is_empty() {
        return Ok(());
    }

    // No part declares the new symbols. Each chunk that prints their file with a scope names them.
    let wraps = c.graph.meta.items_flags();
    for chunk in chunks.iter_mut() {
        let Content::Javascript(js) = &mut chunk.content else {
            continue;
        };
        for file in js.files_in_chunk_order.iter() {
            let (start, len) = files[*file as usize].symbols;
            if len > 0
                && (wraps[*file as usize].wrap == WrapKind::Esm
                    || js.scoped_using_files.binary_search(file).is_ok())
            {
                js.scoped_using_symbols
                    .extend_from_slice(&symbols[start as usize..(start + len) as usize]);
            }
        }
    }
    Ok(())
}

/// The first live part of `file` that declares a top-level `using`.
fn first_using_part(c: &LinkerContext, file: IndexInt) -> u32 {
    let parts_live = &c.graph.parts_live[file as usize];
    c.graph.ast.items_parts()[file as usize]
        .as_slice()
        .iter()
        .enumerate()
        .position(|(index, part)| {
            parts_live.is_set(index) && part.stmts.slice().iter().any(is_using_declaration)
        })
        .map_or(NO_PART, |index| index as u32)
}

/// Joins the ranges of each unwrapped file, from its first `using` to its last range, for one block.
fn block_files_of_chunk(js: &mut JavaScriptChunk, files: &mut [FileState]) {
    let ranges: &[PartRange] = &js.parts_in_chunk_in_order;
    let mut has_using = false;
    for (index, range) in ranges.iter().enumerate() {
        let state = &mut files[range.source_index.get() as usize];
        if state.using_part != NO_PART {
            state.last_range = index as u32;
            has_using = true;
        }
    }
    if !has_using {
        return;
    }

    let mut joined: Vec<PartRange> = Vec::with_capacity(ranges.len());
    let mut index = 0;
    while index < ranges.len() {
        let range = ranges[index];
        let file = range.source_index.get();
        let state = files[file as usize];
        let last = state.last_range as usize;
        if (range.part_index_begin..range.part_index_end).contains(&state.using_part)
            && last + 1 < ranges.len()
            && ranges[index..=last]
                .iter()
                .all(|other| other.source_index.get() == file)
        {
            joined.push(PartRange {
                part_index_end: ranges[last].part_index_end,
                ..range
            });
            js.scoped_using_files.push(file);
            files[file as usize].has_block = true;
            index = last + 1;
        } else {
            joined.push(range);
            index += 1;
        }
    }
    js.parts_in_chunk_in_order = joined.into_boxed_slice();
    js.scoped_using_files.sort_unstable();
}

/// The bindings of the live top-level `using` declarations of `file`.
fn top_level_using_bindings(c: &LinkerContext, file: IndexInt, bindings: &mut Vec<Ref>) {
    let parts_live = &c.graph.parts_live[file as usize];
    let parts: &[Part] = c.graph.ast.items_parts()[file as usize].as_slice();
    for (index, part) in parts.iter().enumerate() {
        if !parts_live.is_set(index) {
            continue;
        }
        for stmt in part.stmts.slice() {
            if let StmtData::SLocal(local) = &stmt.data
                && local.kind.is_using()
            {
                for decl in local.decls.slice() {
                    if let B::B::BIdentifier(identifier) = decl.binding.data {
                        bindings.push(identifier.r#ref);
                    }
                }
            }
        }
    }
}

/// The top-level `using` bindings of `file` that a statement outside its `__esm` closure reads.
fn using_bindings_read_outside_closure(
    c: &LinkerContext,
    file: IndexInt,
    read_outside: &mut Vec<Ref>,
) {
    let parts: &[Part] = c.graph.ast.items_parts()[file as usize].as_slice();
    let parts_live: &AutoBitSet = &c.graph.parts_live[file as usize];
    let live_parts = || {
        parts
            .iter()
            .enumerate()
            .filter(|(index, _)| parts_live.is_set(*index))
            .map(|(_, part)| part)
    };

    let mut bindings: Vec<Ref> = Vec::new();
    top_level_using_bindings(c, file, &mut bindings);
    // A direct `eval` can name any binding, and a React Compiler part records no reads.
    if c.graph.ast.items_module_scope()[file as usize].contains_direct_eval
        || live_parts().any(|part| part.tag == PartTag::ReactCompiler)
    {
        read_outside.append(&mut bindings);
        return;
    }

    let exports = c.graph.ast.items_named_exports()[file as usize].values();
    let mut is_read: Vec<bool> = bindings
        .iter()
        .map(|binding| exports.iter().any(|export| export.ref_ == *binding))
        .collect();
    for part in live_parts() {
        if part.stmts.slice().iter().any(leaves_esm_closure) {
            for (binding, is_read) in bindings.iter().zip(is_read.iter_mut()) {
                *is_read = *is_read || part.symbol_uses.contains(binding);
            }
        }
    }
    read_outside.extend(
        bindings
            .iter()
            .zip(is_read)
            .filter_map(|(binding, is_read)| is_read.then_some(*binding)),
    );
}

impl LinkerContext<'_> {
    /// Prints `using res = v` as `using inner = res = v`. `declare_outside` declares `res` there.
    #[cold]
    pub(crate) fn bind_using_inside_scope(
        &self,
        stmt: Stmt,
        bump: &Bump,
        declare_outside: &mut dyn FnMut(Ref, Loc) -> Expr,
    ) -> Stmt {
        let StmtData::SLocal(local) = stmt.data else {
            return stmt;
        };
        let inner_binding = |decl: &G::Decl| match decl.binding.data {
            B::B::BIdentifier(identifier) => self
                .scoped_using_bindings
                .get(&identifier.r#ref)
                .map(|inner| (identifier.r#ref, *inner)),
            _ => None,
        };
        if self.scoped_using_bindings.is_empty()
            || !local
                .decls
                .slice()
                .iter()
                .any(|decl| inner_binding(decl).is_some())
        {
            return stmt;
        }
        let mut decls: Vec<G::Decl> = Vec::with_capacity(local.decls.len());
        for decl in local.decls.slice() {
            decls.push(match (inner_binding(decl), decl.value) {
                (Some((binding, inner)), Some(value)) => G::Decl {
                    binding: Binding::alloc(bump, B::Identifier { r#ref: inner }, decl.binding.loc),
                    value: Some(Expr::assign(
                        declare_outside(binding, decl.binding.loc),
                        value,
                    )),
                },
                _ => G::Decl {
                    binding: decl.binding,
                    value: decl.value,
                },
            });
        }
        // The statement is shared with the other chunks that print the file.
        Stmt::alloc(
            S::Local {
                kind: local.kind,
                decls: G::DeclList::move_from_list(decls),
                is_export: false,
                origin: local.origin,
            },
            stmt.loc,
        )
    }

    /// Puts the statements from the first top-level `using` on in a block. What it hides becomes a `var`.
    #[cold]
    pub(crate) fn scope_using_in_block(&self, stmts: &mut Vec<Stmt>, bump: &Bump) {
        let Some(first_using) = stmts.iter().position(is_using_declaration) else {
            return;
        };
        let mut outside: Vec<G::Decl> = Vec::new();
        let mut inside: Vec<Stmt> = Vec::with_capacity(stmts.len() - first_using);
        let mut kept = first_using;
        for index in first_using..stmts.len() {
            let stmt = stmts[index];
            if leaves_block(&stmt) {
                stmts[kept] = stmt;
                kept += 1;
                continue;
            }
            inside.push(match stmt.data {
                StmtData::SClass(mut class) => {
                    let name = class
                        .class
                        .class_name
                        .expect("a class statement has a name");
                    let class_ref: StoreRef<E::Class> = StoreRef::from_bump(&mut class.class);
                    Stmt::alloc(
                        S::Local {
                            decls: G::DeclList::from_slice(&[G::Decl {
                                binding: Binding::alloc(
                                    bump,
                                    B::Identifier { r#ref: name.ref_ },
                                    name.loc,
                                ),
                                value: Some(Expr {
                                    data: bun_ast::ExprData::EClass(class_ref),
                                    loc: stmt.loc,
                                }),
                            }]),
                            ..Default::default()
                        },
                        stmt.loc,
                    )
                }
                StmtData::SLocal(local) if local.kind.is_using() => {
                    self.bind_using_inside_scope(stmt, bump, &mut |ref_, loc| {
                        outside.push(G::Decl {
                            binding: Binding::alloc(bump, B::Identifier { r#ref: ref_ }, loc),
                            value: None,
                        });
                        Expr::init_identifier(ref_, loc)
                    })
                }
                StmtData::SLocal(local) if local.kind != S::Kind::KVar => Stmt::alloc(
                    S::Local {
                        decls: G::DeclList::from_slice(local.decls.slice()),
                        origin: local.origin,
                        ..Default::default()
                    },
                    stmt.loc,
                ),
                _ => stmt,
            });
        }
        stmts.truncate(kept);
        if !outside.is_empty() {
            stmts.push(Stmt::alloc(
                S::Local {
                    decls: G::DeclList::move_from_list(outside),
                    ..Default::default()
                },
                Loc::EMPTY,
            ));
        }
        stmts.push(Stmt::alloc(
            S::Block {
                stmts: bun_ast::StoreSlice::new_mut(bump.alloc_slice_copy(&inside)),
                close_brace_loc: Loc::EMPTY,
            },
            Loc::EMPTY,
        ));
    }
}

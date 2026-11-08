//! The parser keeps a top-level `using` as it is written when the target runs it natively. Its
//! binding then exists only in the scope that the linker prints the declaration in. For a file
//! with an `__esm` wrapper that scope is the closure, and function declarations, values that run
//! no code, and the namespace object of the file print outside it.
//!
//! A binding that such a statement reads gets a second symbol here. Its declaration prints as
//! `using inner = binding = value`, and `binding` is declared outside the scope.
//!
//! Runs before the renamers: it makes symbols.

use crate::mal_prelude::*;
use bun_alloc::Arena as Bump;
use bun_ast::symbol;
use bun_ast::{B, Binding, Expr, G, Loc, PartTag, Ref, S, Stmt, StmtData};
use bun_collections::{AutoBitSet, HashMap, VecExt};

use crate::bundled_ast::Flags as AstFlags;
use crate::chunk::Content;
use crate::linker_context_mod::debug;
use crate::options::Format;
use crate::{Chunk, IndexInt, LinkerContext, Part, WrapKind};

/// A top-level `using` binding that a statement outside its scope reads, to the symbol that its
/// declaration binds inside the scope.
pub(crate) type ScopedUsingBindings = HashMap<Ref, Ref>;

/// Does the hoist loop of `generate_code_for_file_in_chunk_js` print `stmt`, or a value in it,
/// outside the `__esm` closure?
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

pub(crate) fn scope_top_level_using(
    c: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), bun_alloc::AllocError> {
    c.scoped_using_bindings.clear();
    if c.options.output_format == Format::InternalBakeDev {
        return Ok(());
    }
    let ast_flags = c.graph.ast.items_flags();
    let wraps = c.graph.meta.items_flags();
    let wrapped_files_with_using: Vec<IndexInt> = c
        .graph
        .reachable_files
        .iter()
        .map(|file| file.get())
        .filter(|&file| {
            ast_flags
                .get(file as usize)
                .is_some_and(|flags| flags.contains(AstFlags::HAS_TOP_LEVEL_USING))
                && wraps[file as usize].wrap == WrapKind::Esm
        })
        .collect();
    if wrapped_files_with_using.is_empty() {
        return Ok(());
    }

    // Per file: where its symbols are in `symbols`.
    let mut symbols_of_file = vec![(0u32, 0u32); ast_flags.len()];
    let mut symbols: Vec<Ref> = Vec::new();
    let mut read_outside: Vec<Ref> = Vec::new();
    for file in wrapped_files_with_using {
        read_outside.clear();
        using_bindings_read_outside_closure(c, file, &mut read_outside);
        symbols_of_file[file as usize] = (symbols.len() as u32, read_outside.len() as u32);
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
    debug!("scope_top_level_using: {} symbols", symbols.len());
    if symbols.is_empty() {
        return Ok(());
    }

    // No part declares the new symbols. Each chunk that prints their file names them.
    for chunk in chunks.iter_mut() {
        let Content::Javascript(js) = &mut chunk.content else {
            continue;
        };
        for file in js.files_in_chunk_order.iter() {
            let (start, len) = symbols_of_file[*file as usize];
            js.scoped_using_symbols
                .extend_from_slice(&symbols[start as usize..(start + len) as usize]);
        }
    }
    Ok(())
}

/// The top-level `using` bindings of `file` that a statement printed outside its `__esm` closure
/// reads.
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
    for part in live_parts() {
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
    // A direct `eval` can name any binding. The functions that the React Compiler outlines are
    // in a part of their own, and the part of the component records what they read.
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
    /// `using res = v` as `using inner = res = v`, for each binding that a statement outside the
    /// scope reads. `declare_outside` declares `res` there and gives the reference to assign.
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
}

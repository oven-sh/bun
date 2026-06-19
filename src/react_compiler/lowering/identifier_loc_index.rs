//! Port of `react_compiler_lowering/identifier_loc_index.rs` — see ../DESIGN.md.
//!
//! Upstream builds a `node_id → (start, loc, is_jsx, is_declaration_name,
//! in_type_annotation)` map by walking the function's AST (including a
//! `serde_json` walk over untyped class bodies and type-annotation subtrees),
//! so that `gather_captured_context` and `find_context_identifiers` can
//! resolve a `ScopeInfo.ref_node_id_to_binding` entry back to a source
//! position and a handful of context flags.
//!
//! Bun has no `node_id`: every `EIdentifier` / `EImportIdentifier` carries its
//! `Ref` and `Loc` inline, Bun's class bodies are typed AST (no JSON walk),
//! and Bun's parser strips type annotations before lowering. The upstream
//! bridge map therefore collapses — consumers read `Ref` + `Loc` straight off
//! the AST node and call `hir_builder::convert_loc`. The types below are kept
//! so that the Bun ports of `gather_captured_context` /
//! `find_context_identifiers` have a shared shape for the per-reference data
//! they collect during their own AST walk.

#![allow(dead_code)]

use crate::hir::SourceLocation;
use bun_ast::Ref;

/// Source location and context flags for a single identifier reference.
///
/// Upstream keys this by `node_id`; Bun keys by the reference's `Ref` together
/// with its byte offset (a `Ref` alone is not unique per use site).
pub(super) struct IdentifierLocEntry {
    /// The binding this reference resolves to.
    pub ref_: Ref,
    /// Byte offset of the reference (`Loc.start`). Stored so callers can do
    /// position-range containment checks against a nested function's span.
    pub start: i32,
    /// Upstream skips the entry entirely when the AST node has no loc, so a
    /// `None` here must be treated as "entry absent" by consumers (skip it).
    pub loc: Option<SourceLocation>,
    pub is_jsx: bool,
    /// For JSX identifiers that are the root name of a JSXOpeningElement,
    /// stores the JSXOpeningElement's loc (which spans the full tag).
    pub opening_element_loc: Option<SourceLocation>,
    /// True if this identifier is the name of a function/class declaration
    /// (not an expression reference). Used by `gather_captured_context` to
    /// skip non-expression positions, matching the TS behavior where the
    /// Expression visitor doesn't visit declaration names.
    pub is_declaration_name: bool,
    // `in_type_annotation` is dropped: Bun's parser strips type annotations,
    // so no identifier reference can sit inside one. Upstream's
    // `find_context_identifiers` and the hoisting analysis *do* consume
    // type-annotation references (e.g. `typeof x`); the Bun ports therefore
    // omit those — accepted because such references are erased at runtime.
}

/// Flat list of identifier references inside a function body.
///
/// Upstream is `HashMap<node_id, IdentifierLocEntry>`; Bun has no `node_id`,
/// so this is a `Vec` keyed implicitly by `(start, ref_)`. Consumers iterate
/// the whole list and filter by `start` range / `ref_` equality.
pub(super) type IdentifierLocIndex = Vec<IdentifierLocEntry>;

// `build_identifier_loc_index` is intentionally not ported: upstream needs a
// separate AST walk (plus a `serde_json` walk for class bodies and type
// annotations) because its `ScopeInfo` only knows `node_id`s. Bun's
// `gather_captured_context` / `find_context_identifiers` walk `bun_ast`
// directly and read `Ref` + `Loc` off each `EIdentifier` inline, so there is
// no pre-walk to do here. See the `HirBuilder` contract: the
// `&IdentifierLocIndex` field was dropped and callers use
// `hir_builder::convert_loc(expr.loc)` directly.

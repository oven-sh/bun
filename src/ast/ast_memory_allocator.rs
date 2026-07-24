//! Compatibility shim: the AST allocator is now the passed-by-value
//! [`bun_alloc::AstArena`]. The old thread-local install/restore machinery
//! (`push`/`pop`/`enter`/`Scope` swapping `AST_ALLOC`) is gone; callers own an
//! `AstArena` and thread its [`bun_alloc::AstAlloc`] handle explicitly.

pub use bun_alloc::AstArena as ASTMemoryAllocator;

/// No-op RAII shim kept for out-of-crate callers that still bracket a parse
/// with `let _scope = alloc.enter();`. The arena is passed explicitly now, so
/// there is nothing to install or restore.
#[derive(Default)]
pub struct Scope<'a>(core::marker::PhantomData<&'a mut ASTMemoryAllocator>);

impl<'a> Scope<'a> {
    #[inline]
    pub fn enter(&mut self) {}
    #[inline]
    pub fn exit(&mut self) {}
}

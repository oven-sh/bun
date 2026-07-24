//! Compatibility shim: the AST allocator is [`bun_alloc::AstArena`]. Callers
//! own an `AstArena` and bracket every parse with
//! `let _scope = ast_arena.enter();`, which installs it as the thread's active
//! arena for the ZST [`bun_alloc::AstAlloc`] to read.

pub use bun_alloc::AstArena as ASTMemoryAllocator;
pub use bun_alloc::ast_alloc::AstScope as Scope;

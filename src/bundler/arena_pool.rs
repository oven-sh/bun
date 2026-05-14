//! Append-only owner of per-worker [`MimallocArena`]s for one bundle pass.
//!
//! The bundler produces `Ast<'arena>` values on N worker threads, each
//! allocating into its own thread-local `MimallocArena`, and stores them in a
//! single `Graph.ast: MultiArrayList<BundledAst<'a>>` on the bundler thread.
//! For borrowck to accept that, every arena must be owned by something with a
//! single lifetime `'a` that outlives `BundleV2<'a>` — that owner is
//! [`ArenaPool`], stack-allocated in the entry-point function alongside the
//! `Transpiler<'a>`.
//!
//! Each worker calls [`ArenaPool::alloc`] once on its own thread (so the
//! `MimallocArena` debug `owning_thread` stamp is correct) and gets back a
//! `&'a MimallocArena` that is valid for the entire bundle pass. The pool
//! never frees an arena until it is dropped, so addresses are stable.
//!
//! This replaces the prior `erase_ast_arena` / `erase_bundled_ast_arena`
//! transmutes (and the `detach_lifetime_ref` on `Worker.arena`): instead of
//! erasing `'arena` to `'static` at the parser→bundler boundary, the arena
//! lifetime is threaded as `'a` end-to-end.

use bun_alloc::MimallocArena;

/// Append-only `MimallocArena` owner. Stack-allocated in the bundle entry
/// point; `&'a ArenaPool` is threaded into `BundleV2<'a>` / `ThreadPool<'a>`.
#[derive(Default)]
pub struct ArenaPool {
    /// `boxcar::Vec` is a lock-free append-only vector with stable element
    /// addresses: `push` returns an index and `&self[i]` borrows `&self`
    /// (not a lock guard), so the returned `&MimallocArena` lives for the
    /// pool's lifetime with no `unsafe` here.
    arenas: boxcar::Vec<MimallocArena>,
}

impl ArenaPool {
    #[inline]
    pub fn new() -> Self {
        Self::default()
    }

    /// Construct a fresh `MimallocArena` on the **calling thread** (so its
    /// debug `owning_thread` stamp is correct), park it in the pool, and
    /// return a shared reference valid for the pool's lifetime.
    ///
    /// Called once per worker thread (from `Worker::create`) and once for
    /// `Graph.heap` (from `BundleV2::init`).
    pub fn alloc(&self) -> &MimallocArena {
        let i = self.arenas.push(MimallocArena::new());
        &self.arenas[i]
    }
}

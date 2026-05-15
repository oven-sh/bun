use core::marker::PhantomData;

// PORT NOTE: This was originally a struct of compile-time metadata (two type
// fields + two string literals) used to drive symbol-export generation. Rust
// has no `type`-valued fields; the closest shape is a generic struct with
// PhantomData markers. In practice this whole mechanism is superseded in Rust by
// `#[unsafe(no_mangle)] pub extern "C" fn ...` at the definition site — Phase B
// may delete this type outright once callers are migrated.

pub struct StaticExport<T, P> {
    /// Marker for the exported value's type.
    pub ty: PhantomData<T>,
    // PORT NOTE: `&'static str` (not `&'static [u8]`) because these are always
    // ASCII identifier literals and feed into const string concatenation below.
    pub symbol_name: &'static str,
    pub local_name: &'static str,
    /// Marker for the type that declares the export.
    pub parent: PhantomData<P>,
}

impl<T, P> StaticExport<T, P> {
    // TODO(port): The original used compile-time declaration reflection, which
    // has no Rust equivalent. The consumer of this metadata should become a
    // proc-macro / build-script. Stubbed to `()`.
    pub const fn decl(&self) {
        // TODO(port): proc-macro
    }

    // Builds `"wrap" + symbol_name`.
    // PORT NOTE: const string concatenation over a *field* is not expressible
    // in stable Rust. Return an owned `String` so the caller controls the
    // lifetime — `Box::leak` is forbidden per docs/PORTING.md (it would leak a
    // fresh allocation on every call, whereas the original was a single
    // compile-time-interned constant). Callers holding a literal should prefer
    // `const_format::concatcp!("wrap", SYM)` to recover the compile-time
    // semantics; Phase B replaces this whole mechanism with `#[no_mangle]` +
    // proc-macro.
    // PERF(port): was compile-time `++` (zero-cost) — profile in Phase B
    pub fn wrapped_name(&self) -> String {
        let mut s = String::with_capacity(4 + self.symbol_name.len());
        s.push_str("wrap");
        s.push_str(self.symbol_name);
        s
    }
}

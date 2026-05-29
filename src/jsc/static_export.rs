use core::marker::PhantomData;

pub struct StaticExport<T, P> {
    // Zig: `Type: type`
    pub ty: PhantomData<T>,
    // PORT NOTE: `&'static str` (not `&'static [u8]`) because these are always
    // ASCII identifier literals and feed into const string concatenation below.
    pub symbol_name: &'static str,
    pub local_name: &'static str,
    // Zig: `Parent: type`
    pub parent: PhantomData<P>,
}

impl<T, P> StaticExport<T, P> {
    // TODO(port): `std.meta.declarationInfo(Parent, local_name)` is comptime
    // reflection (`@typeInfo`) with no Rust equivalent. The consumer of this
    // metadata should become a proc-macro / build-script. Stubbed to `()`.
    pub const fn decl(&self) {
        // TODO(port): proc-macro
    }

    pub fn wrapped_name(&self) -> String {
        let mut s = String::with_capacity(4 + self.symbol_name.len());
        s.push_str("wrap");
        s.push_str(self.symbol_name);
        s
    }
}

// ported from: src/jsc/static_export.zig

bun_opaque::sealed_handle! {
    /// Opaque FFI handle for `JSC::JSCell`.
    pub struct JSCell;
}

// ════════════════════════════════════════════════════════════════════════════
// JsCell<T> — single-JS-thread interior mutability
// ════════════════════════════════════════════════════════════════════════════

pub use bun_ptr::JsCell;

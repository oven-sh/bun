// For WASM builds
pub struct C;
pub struct WebCore;
pub struct Jest;
#[allow(non_snake_case)]
pub mod API {
    // TODO(port): Zig `API` is an empty struct used as a namespace; Rust cannot nest
    // type definitions inside a struct, so this is a module. If `API` is ever used
    // as a value type, add `pub struct API;` alongside.
    pub struct Transpiler;
}
pub struct Node;

pub struct VirtualMachine;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc_stub.zig (10 lines)
//   confidence: high
//   todos:      1
//   notes:      WASM-build placeholder types; API is a module (Rust can't nest types in structs)
// ──────────────────────────────────────────────────────────────────────────

---
name: implementing-jsc-classes-rust
description: Creates JavaScript classes using Bun's Rust bindings generator (.classes.ts). Use when implementing new JS APIs in Rust with JSC integration, prototypes, or constructors.
---

# Bun's JavaScriptCore Class Bindings Generator

Bridge JavaScript and Rust through `.classes.ts` definitions and Rust implementations.

## Architecture

1. **JavaScript Interface Definition** (`.classes.ts` files)
2. **Rust Implementation** (`.rs` files)
3. **Generated Code** — `src/codegen/generate-classes.ts` emits C++ + Rust into `${BUN_CODEGEN_DIR}/generated_classes.rs`, `include!`d as `crate::generated_classes` in `bun_runtime`. Run `bun bd` to regenerate.

## Class Definition (.classes.ts)

```typescript
export default [
  define({
    name: "Glob",
    construct: true,
    finalize: true,
    hasPendingActivity: true,
    proto: {
      scan:  { fn: "scan",  length: 1 },
      match: { fn: "match", length: 1 },
    },
  }),
];
```

Options:

- `construct`: Has a public `new Foo()` constructor
- `finalize`: Needs cleanup beyond `Drop` (rarely — see Finalize below)
- `hasPendingActivity`: GC keep-alive while async work is in flight
- `proto`: Methods (`fn:`), getters (`getter: true`, optionally `cache: true`)
- `values: [...]`: WriteBarrier slots for JS values the native side holds (callbacks, buffers)

## Rust Implementation

```rust
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use std::sync::atomic::{AtomicUsize, Ordering};

#[bun_jsc::JsClass]
pub struct Glob {
    pattern: Box<[u8]>,
    has_pending_activity: AtomicUsize,
}

impl Glob {
    pub fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Glob>> {
        let arg = frame.argument(0);
        let pattern = bun_core::String::from_js(arg, global)?.to_utf8_bytes().into();
        Ok(Box::new(Glob { pattern, has_pending_activity: AtomicUsize::new(0) }))
    }

    #[bun_jsc::host_fn(method)]
    pub fn r#match(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // ...
        Ok(JSValue::TRUE)
    }

    pub fn has_pending_activity(&self) -> bool {
        self.has_pending_activity.load(Ordering::SeqCst) > 0
    }
}
```

### Canonical signatures

| Hook                | Signature                                                                            |
| ------------------- | ------------------------------------------------------------------------------------ |
| constructor         | `pub fn constructor(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<Box<Self>>` |
| method (`fn:`)      | `pub fn name(&self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>`   |
| getter              | `pub fn get_x(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue>`               |
| finalize            | `pub fn finalize(self: Box<Self>)` — or omit; the blanket `JsFinalize` just drops    |
| hasPendingActivity  | `pub fn has_pending_activity(&self) -> bool`                                         |

A missing or mis-typed hook is a **compile error** in `cargo check -p bun_runtime` — the generated code calls the inherent method directly.

## Hooking into the generated module

`#[bun_jsc::JsClass]` on the struct implements the `JsClass` trait (`to_js`, `from_js`, `from_js_direct`, `get_constructor`) by binding the C++ externs. Attribute knobs: `no_constructor`, `no_finalize`, `estimated_size`.

The codegen also emits a `js_$T` module with the cached-value accessors. Re-export it when you need `*_set_cached` / `*_get_cached` or `detach_ptr`:

```rust
pub use crate::generated_classes::js_Glob as js;
// or
bun_jsc::impl_js_class_via_generated!(Archive => crate::generated_classes::js_Archive);
```

The `js_$T` module surface:

```rust
pub fn from_js(value: JSValue) -> Option<NonNull<T>>;
pub fn from_js_direct(value: JSValue) -> Option<NonNull<T>>;
pub fn get_constructor(global: &JSGlobalObject) -> JSValue;
pub fn to_js(this: *mut T, global: &JSGlobalObject) -> JSValue;   // ownership transfer
pub fn detach_ptr(value: JSValue);
// per cached getter / `values: [...]` entry:
pub fn <field>_set_cached(this_value: JSValue, global: &JSGlobalObject, value: JSValue);
pub fn <field>_get_cached(this_value: JSValue) -> Option<JSValue>;
```

## Finalize

Most classes need nothing — `#[bun_jsc::JsClass]` wires the blanket `JsFinalize` whose default is `drop(Box<Self>)`. Override only when you must release a JS handle or defer to a heap helper:

```rust
pub fn finalize(self: Box<Self>) {
    bun_ptr::finalize_js_box(self, |this| this.this_value.with_mut(|v| v.finalize()));
}
```

Override with an **inherent** method, never `impl JsFinalize for T`.

## Holding JS values

Never store raw `JSValue` in a struct field. Declare a slot in `.classes.ts` (`values: ["callback"]` or a `cache: true` getter) and read/write it through `js::callback_set_cached(this_value, global, v)` / `js::callback_get_cached(this_value)`. The slot is a `WriteBarrier` visited by the GC, so the value stays alive without a `Strong`.

## Reference implementations

- `src/runtime/api/glob.rs` + `Glob.classes.ts` — constructor, methods, `hasPendingActivity`, default finalize
- `src/runtime/api/cron.rs` + `cron.classes.ts` — `noConstructor`, cached getter, `values: [...]`, custom finalize
- `src/runtime/image/Image.rs:56` — the `pub use crate::generated_classes::js_Image as js;` one-liner
- `src/jsc/host_fn.rs` — the host-fn adapters the codegen dispatches through
- `src/jsc_macros/lib.rs` — `#[bun_jsc::JsClass]` proc-macro source

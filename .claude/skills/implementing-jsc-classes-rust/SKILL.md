---
name: implementing-jsc-classes-rust
description: Creates JavaScript classes using Bun's bindings generator (.bind.ts). Use when implementing new JS APIs in Rust with JSC integration, prototypes, or constructors.
---

# JavaScript classes implemented in Rust

A class is a `b.class({..})` exported from a `*.bind.ts` file and a Rust struct. `src/codegen/bindgen.ts` generates the C++
cell, prototype and constructor, the argument conversions, and the Rust functions that call the struct's methods.
`docs/project/bindgen.mdx` is the reference: read its "Classes" section before writing one.

## Schema

```typescript
import * as b from "../../codegen/bindgen-lib.ts";

export const Matcher = b.class({
  rustPath: "crate::api::matcher::Matcher",
  construct: { args: { pattern: b.string.utf8 } },
  internalFields: ["callback"],
  proto: {
    match: { args: { text: b.string.utf8 }, returns: b.bool },
    pattern: { getter: b.string.utf8, cache: true },
  },
});
```

## Rust

```rust
pub struct Matcher {
    pattern: Box<[u8]>,
}

impl Matcher {
    pub fn constructor(pattern: &[u8]) -> Self {
        Self { pattern: pattern.into() }
    }

    pub fn r#match(&self, text: &[u8]) -> bool {
        bun_core::strings::contains(text, &self.pattern)
    }

    pub fn get_pattern(&self) -> &[u8] {
        &self.pattern
    }
}
```

A missing or mis-typed method is a compile error: the generated code calls it directly.

## Where the struct lives

- Freed when its JS object is freed: it is stored inside the object. This is the default. Cleanup is `Drop`.
- Can outlive its object (a timer, another thread or a C library still points at it): `refCounted: true`. It is a separate,
  refcounted heap allocation, and the object holds one ref.

## What a body may do

`capability: "heap"` adds `heap: &JsHeap<'a>` (allocate, throw). `capability: "js"` adds `cx: &mut JsScope<'a>` (also run
JavaScript); `cx.global()` is the `&JSGlobalObject` the rest of the tree takes. `throws: true` makes the result a
`JsResult<T>`. `passThis: true` adds the object, `this_value: JsWrapper<'a, Self>`.

Every member takes `&self`; state that changes is in `Cell` or `JsCell`.

## Holding JS values

Never store a raw `JSValue` in a struct field. Declare an internal field (`internalFields: ["callback"]` or a `cache: true`
getter) and use `js_Matcher::callback_set_cached(this_value, global, value)` / `callback_get_cached(this_value)` from
`crate::generated_bindgen::<file>`. To reach its own object the struct stores a `JsRef`.

## Reference implementations

- `src/jsc/bindgen_test.bind.ts` + `src/jsc/bindgen_test.rs`: an example of most keys
- `src/jsc/resolve_message.bind.ts`: cached getters, `prototypeBase`, `construct: "illegal"`
- `src/runtime/api/cron.bind.ts`: `refCounted`, `finalize`

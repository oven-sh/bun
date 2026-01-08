---
name: implementing-jsc-classes-zig
description: Creates JavaScript classes using Bun's Zig bindings generator (.classes.ts). Use when implementing new JS APIs in Zig with JSC integration.
---

# Bun's JavaScriptCore Class Bindings Generator

Bridge JavaScript and Zig through `.classes.ts` definitions and Zig implementations.

## Architecture

1. **Zig Implementation** (.zig files)
2. **JavaScript Interface Definition** (.classes.ts files)
3. **Generated Code** (C++/Zig files connecting them)

## Class Definition (.classes.ts)

```typescript
define({
  name: "TextDecoder",
  constructor: true,
  JSType: "object",
  finalize: true,
  proto: {
    decode: { args: 1 },
    encoding: { getter: true, cache: true },
    fatal: { getter: true },
  },
});
```

Options:

- `name`: Class name
- `constructor`: Has public constructor
- `JSType`: "object", "function", etc.
- `finalize`: Needs cleanup
- `proto`: Properties/methods
- `cache`: Cache property values via WriteBarrier

## Zig Implementation

```zig
pub const TextDecoder = struct {
    pub const js = JSC.Codegen.JSTextDecoder;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    encoding: []const u8,
    fatal: bool,

    pub fn constructor(
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!*TextDecoder {
        return bun.new(TextDecoder, .{ .encoding = "utf-8", .fatal = false });
    }

    pub fn decode(
        this: *TextDecoder,
        globalObject: *JSGlobalObject,
        callFrame: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        const args = callFrame.arguments();
        if (args.len < 1 or args.ptr[0].isUndefinedOrNull()) {
            return globalObject.throw("Input cannot be null", .{});
        }
        return JSC.JSValue.jsString(globalObject, "result");
    }

    pub fn getEncoding(this: *TextDecoder, globalObject: *JSGlobalObject) JSC.JSValue {
        return JSC.JSValue.createStringFromUTF8(globalObject, this.encoding);
    }

    fn deinit(this: *TextDecoder) void {
        // Release resources
    }

    pub fn finalize(this: *TextDecoder) void {
        this.deinit();
        bun.destroy(this);
    }
};
```

**Key patterns:**

- Use `bun.JSError!JSValue` return type for error handling
- Use `globalObject` not `ctx`
- `deinit()` for cleanup, `finalize()` called by GC
- Update `src/bun.js/bindings/generated_classes_list.zig`

## CallFrame Access

```zig
const args = callFrame.arguments();
const first_arg = args.ptr[0];  // Access as slice
const argCount = args.len;
const thisValue = callFrame.thisValue();
```

## Property Caching

For `cache: true` properties, generated accessors:

```zig
// Get cached value
pub fn encodingGetCached(thisValue: JSC.JSValue) ?JSC.JSValue {
    const result = TextDecoderPrototype__encodingGetCachedValue(thisValue);
    if (result == .zero) return null;
    return result;
}

// Set cached value
pub fn encodingSetCached(thisValue: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
    TextDecoderPrototype__encodingSetCachedValue(thisValue, globalObject, value);
}
```

## Error Handling

```zig
pub fn method(this: *MyClass, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const args = callFrame.arguments();
    if (args.len < 1) {
        return globalObject.throw("Missing required argument", .{});
    }
    return JSC.JSValue.jsString(globalObject, "Success!");
}
```

## Memory Management

```zig
pub fn deinit(this: *TextDecoder) void {
    this._encoding.deref();
    if (this.buffer) |buffer| {
        bun.default_allocator.free(buffer);
    }
}

pub fn finalize(this: *TextDecoder) void {
    JSC.markBinding(@src());
    this.deinit();
    bun.default_allocator.destroy(this);
}
```

## Creating a New Binding

1. Define interface in `.classes.ts`:

```typescript
define({
  name: "MyClass",
  constructor: true,
  finalize: true,
  proto: {
    myMethod: { args: 1 },
    myProperty: { getter: true, cache: true },
  },
});
```

2. Implement in `.zig`:

```zig
pub const MyClass = struct {
    pub const js = JSC.Codegen.JSMyClass;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;

    value: []const u8,

    pub const new = bun.TrivialNew(@This());

    pub fn constructor(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!*MyClass {
        return MyClass.new(.{ .value = "" });
    }

    pub fn myMethod(this: *MyClass, globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        return JSC.JSValue.jsUndefined();
    }

    pub fn getMyProperty(this: *MyClass, globalObject: *JSGlobalObject) JSC.JSValue {
        return JSC.JSValue.jsString(globalObject, this.value);
    }

    pub fn deinit(this: *MyClass) void {}

    pub fn finalize(this: *MyClass) void {
        this.deinit();
        bun.destroy(this);
    }
};
```

3. Add to `src/bun.js/bindings/generated_classes_list.zig`

## Generated Components

- **C++ Classes**: `JSMyClass`, `JSMyClassPrototype`, `JSMyClassConstructor`
- **Method Bindings**: `MyClassPrototype__myMethodCallback`
- **Property Accessors**: `MyClassPrototype__myPropertyGetterWrap`
- **Zig Bindings**: External function declarations, cached value accessors

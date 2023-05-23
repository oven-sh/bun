# Contributing to Bun

> **Important:** All contributions need test coverage. If you are adding a new feature, please add a test. If you are fixing a bug, please add a test that fails before your fix and passes after your fix.

## Bun's codebase

Bun is written mostly in Zig, but WebKit & JavaScriptCore (the JavaScript engine) is written in C++.

Today (February 2023), Bun's codebase has five distinct parts:

- JavaScript, JSX, & TypeScript transpiler, module resolver, and related code
- JavaScript runtime ([`src/bun.js/`](src/bun.js/))
- JavaScript runtime bindings ([`src/bun.zig/bindings/**/*.cpp`](src/bun.zig/bindings/))
- Package manager ([`src/install/`](src/install/))
- Shared utilities ([`src/string_immutable.zig`](src/string_immutable.zig))

The JavaScript transpiler & module resolver is mostly independent from the runtime. It predates the runtime and is entirely in Zig. The JavaScript parser is mostly in [`src/js_parser.zig`](src/js_parser.zig). The JavaScript AST data structures are mostly in [`src/js_ast.zig`](src/js_ast.zig). The JavaScript lexer is in [`src/js_lexer.zig`](src/js_lexer.zig). A lot of this code started as a port of esbuild's equivalent code from Go to Zig, but has had many small changes since then.

## Getting started

Please refer to [Bun's Development Guide](https://bun.sh/docs/project/development) to get your dev environment setup!

## Memory management in Bun

For the Zig code, please:

1. Do your best to avoid dynamically allocating memory.
2. If we need to allocate memory, carefully consider the owner of that memory. If it's a JavaScript object, it will need a finalizer. If it's in Zig, it will need to be freed either via an arena or manually.
3. Prefer arenas over manual memory management. Manually freeing memory is leak & crash prone.
4. If the memory needs to be accessed across threads, use `bun.default_allocator`. Mimalloc threadlocal heaps are not safe to free across threads.

The JavaScript transpiler has special-handling for memory management. The parser allocates into a single arena and the memory is recycled after each parse.

## JavaScript runtime

Most of Bun's JavaScript runtime code lives in [`src/bun.js`](src/bun.js).

### Calling C++ from Zig & Zig from C++

TODO: document this (see [`bindings.zig`](src/bun.js/bindings/bindings.zig) and [`bindings.cpp`](src/bun.js/bindings/bindings.cpp) for now)

### Adding a new JavaScript class

1. Add a new file in [`src/bun.js/*.classes.ts`](src/bun.js) to define the instance and static methods for the class.
2. Add a new file in [`src/bun.js/**/*.zig`](src/bun.js) and expose the struct in [`src/bun.js/generated_classes_list.zig`](src/bun.js/generated_classes_list.zig)
3. Run `make codegen`

Copy from examples like `Subprocess` or `Response`.

### ESM modules

Bun implements ESM modules in a mix of native code and JavaScript.

Several Node.js modules are implemented in JavaScript and loosely based on browserify polyfills.

The ESM modules in Bun are located in [`src/bun.js/*.exports.js`](src/bun.js/). Unlike other code in Bun, these files are NOT transpiled. They are loaded directly into the JavaScriptCore VM. That means `require` does not work in these files. Instead, you must use `import.meta.require`, or ideally, not use require/import other files at all.

The module loader is in [`src/bun.js/module_loader.zig`](src/bun.js/module_loader.zig).

### JavaScript Builtins

TODO: update this with the new build process that uses TypeScript and `$` instead of `@`.

JavaScript builtins are located in [`src/js/builtins/*.ts`](src/js/builtins).

These files support a JavaScriptCore-only syntax for internal slots. `@` is used to access an internal slot. For example: `new @Array(123)` will create a new `Array` similar to `new Array(123)`, except if a library modifies the `Array` global, it will not affect the internal slot (`@Array`). These names must be allow-listed in `BunBuiltinNames.h` (though JavaScriptCore allowlists some names by default).

They can not use or reference ESM-modules. The files that end with `*Internals.js` are automatically loaded globally. Most usage of internals right now are the stream implementations (which share a lot of code from Safari/WebKit) and ImportMetaObject (which is how `require` is implemented in the runtime)

To regenerate the builtins:

```sh
make clean-bindings && make generate-builtins && make bindings -j10
```

It is recommended that you have ccache installed or else you will spend a lot of time waiting for the bindings to compile.

### Memory management in Bun's JavaScript runtime

TODO: fill this out (for now, use `JSC.Strong` in most cases)

### Strings

TODO: fill this out (for now, use `JSValue.toSlice()` in most cases)

#### JavaScriptCore C API

Do not copy from examples leveraging the JavaScriptCore C API. Please do not use this in new code. We will not accept PRs that add new code that uses the JavaScriptCore C API.

## Testing

See [`test/README.md`](test/README.md) for information on how to run tests.

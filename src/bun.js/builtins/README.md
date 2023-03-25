# JavaScript Builtins

TLDR:

```bash
# Delete the built files
make clean-bindings generate-builtins && \
    # Compile all the C++ files which live in ../bindings
    make bindings -j10 && \
    # Re-link the binary without compiling zig (so it's faster)
    make bun-link-lld-debug
```

JavaScript files in [./js](./js) use JavaScriptCore's builtins syntax

```js
@getter
function foo() {
    return @getByIdDirectPrivate(this, "superSecret");
}
```

It looks kind of like decorators but they're not. They let you directly call engine intrinsics and help with avoiding prototype pollution issues.

V8 has a [similar feature](https://v8.dev/blog/embedded-builtins) (they use `%` instead of `@`)

They usually are accompanied by a C++ file.

The `js` directory is necessary for the bindings generator to work.

To regenerate the builtins, run this from Bun's project root (where the `Makefile` is)

```bash
make generate-builtins
```

You'll want to also rebuild all the C++ bindings or you will get strange crashes on start

```bash
make clean-bindings
```

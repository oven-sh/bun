# JavaScript Builtins

**TLDR** — When files in this directory change, run:

```bash
# Delete the built files
$ make regenerate-bindings
# Re-link the binary without compiling zig (so it's faster)
$ make bun-link-lld-debug
```

TypeScript files in [./ts](./ts) are bundled into C++ Headers that can access JavaScriptCore intrinsics. These files use special globals that are prefixed with `$`.

```js
$getter
export function foo() {
    return $getByIdDirectPrivate(this, "superSecret");
}
```

It looks kind of like decorators but they're not. They let you directly call engine intrinsics and help with avoiding prototype pollution issues.

V8 has a [similar feature](https://v8.dev/blog/embedded-builtins) (they use `%` instead of `@`)

They usually are accompanied by a C++ file.

We use a custom code generator located in `./codegen` which contains a regex-based parser that separates each function into it's own bundling context, so syntax like top level variables / functions will not work.

You can also use `process.platform` and `process.arch` in these files. The values are inlined and DCE'd.

## Generating builtins

To regenerate the builtins, run this from Bun's project root (where the `Makefile` is)

```bash
$ make builtins
```

You'll want to also rebuild all the C++ bindings or you will get strange crashes on start

```bash
$ make clean-bindings
```

The `make regenerate-bindings` command will clean and rebuild the bindings.

Also, you can run the code generator manually.

```bash
$ bun ./codegen/index.ts
# pass --minify to minify (make passes this by default)
# pass --keep-tmp to keep the temporary ./tmp folder, which contains processed pre-bundled .ts files
```

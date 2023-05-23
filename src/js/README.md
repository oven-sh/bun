# JS Modules

- `./node` contains all `node:*` modules
- `./bun` contains all `bun:*` modules
- `./thirdparty` contains npm modules we replace like `ws`

When you change any of those folders, run this to bundle and minify them:

```bash
$ make bundle-hardcoded
$ make dev
```

Instead of `make dev`, the debug build of bun has an environment variable you can dynamically load these files:

```bash
$ make bundle-hardcoded
$ BUN_OVERRIDE_MODULE_PATH=/path/to/bun/src/js bun-debug ...
```

Saving the above as an alias may be helpful if you are frequently editing the JS modules.

For any private types like `Bun.fs()`, add them to `./private.d.ts`

# Builtins

- `./builtins` contains builtins that use intrinsics. They're inlined into generated C++ code. It's a separate system, see the readme in that folder.

When anything in that is changed, run this to regenerate the code:

```make
$ make regenerate-bindings
$ make bun-link-lld-debug
```

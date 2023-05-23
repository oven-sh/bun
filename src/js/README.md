# JS Modules

- `./node` contains all `node:*` modules
- `./bun` contains all `bun:*` modules
- `./thirdparty` contains npm modules we replace like `ws`

When you change any of those folders, run this to bundle and minify them:

```bash
$ make hardcoded
```

These modules are bundled into the binary, but in debug mode they are loaded from the filesystem, so you do not need to rerun `make dev`. If you want to override the modules in a release build, you can set `BUN_OVERRIDE_MODULE_PATH` to the path to the repo:

```bash
$ BUN_OVERRIDE_MODULE_PATH=/path/to/bun-repo bun ...
```

For any private types like `Bun.fs()`, add them to `./private.d.ts`

# Builtins

- `./builtins` contains builtins that use intrinsics. They're inlined into generated C++ code. It's a separate system, see the readme in that folder.

When anything in that is changed, run this to regenerate the code:

```make
$ make regenerate-bindings
$ make bun-link-lld-debug
```

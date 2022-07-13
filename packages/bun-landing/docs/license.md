## License

bun itself is MIT-licensed.

However, JavaScriptCore (and WebKit) is LGPL-2 and bun statically links it. WebCore files from WebKit are also licensed under LGPL2.

Per LGPL2:

> (1) If you statically link against an LGPL’d library, you must also provide your application in an object (not necessarily source) format, so that a user has the opportunity to modify the library and relink the application.

You can find the patched version of WebKit used by bun here: <https://github.com/jarred-sumner/webkit>. If you would like to relink bun with changes:

- `git submodule update --init --recursive`
- `make jsc`
- `zig build`

This compiles JavaScriptCore, compiles bun’s `.cpp` bindings for JavaScriptCore (which are the object files using JavaScriptCore) and outputs a new `bun` binary with your changes.

bun also statically links these libraries:

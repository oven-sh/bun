<p align="center">
  <a href="https://bun.sh"><img src="https://bun.sh/logo@2x.png" alt="Logo"> <img src="https://bun.sh/Bun@2x.png" style="position: relative; top: -30px; margin-left: 20px; background: #000; padding: 5px"  /></a>
</p>

bun is a new:

- JavaScript runtime with Web APIs like [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch), [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket), and several more built-in. bun embeds JavaScriptCore, which tends to be faster and more memory efficient than more popular engines like V8 (though harder to embed)
- JavaScript/TypeScript/JSX transpiler
- JavaScript & CSS bundler
- Task runner for package.json scripts
- npm-compatible package manager

All in one fast &amp; easy-to-use tool. Instead of 1,000 node_modules for development, you only need bun.

**bun is experimental software**. Join [bun’s Discord](https://bun.sh/discord) for help and have a look at [things that don’t work yet](caveats.md#not-implemented-yet).

Today, bun's primary focus is bun.js: bun's JavaScript runtime.

## Install

Native: (macOS x64 & Silicon, Linux x64, Windows Subsystem for Linux)

```sh
curl -fsSL https://bun.sh/install | bash
```

Docker: (Linux x64)

```sh
docker pull jarredsumner/bun:edge
docker run --rm --init --ulimit memlock=-1:-1 jarredsumner/bun:edge
```

If using Linux, kernel version 5.6 or higher is strongly recommended, but the minimum is 5.1.

## Credits

- While written in Zig instead of Go, bun’s JS transpiler, CSS lexer, and node module resolver source code is based off of @evanw’s esbuild project. @evanw did a fantastic job with esbuild.
- The idea for the name "bun" came from [@kipply](https://github.com/kipply)

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

- [`boringssl`](https://boringssl.googlesource.com/boringssl/), which has [several licenses](https://boringssl.googlesource.com/boringssl/+/refs/heads/master/LICENSE)
- [`libarchive`](https://github.com/libarchive/libarchive), which has [several licenses](https://github.com/libarchive/libarchive/blob/master/COPYING)
- [`libiconv`](https://www.gnu.org/software/libiconv/), which is LGPL2. It’s a dependency of libarchive.
- [`lol-html`](https://github.com/cloudflare/lol-html/tree/master/c-api), which is MIT licensed
- [`mimalloc`](https://github.com/microsoft/mimalloc), which is MIT licensed
- [`picohttp`](https://github.com/h2o/picohttpparser), which is dual-licensed under the Perl License or the MIT License
- [`tinycc`](https://github.com/tinycc/tinycc), which is LGPL v2.1 licensed
- [`uSockets`](https://github.com/uNetworking/uSockets), which is MIT licensed
- [`zlib-cloudflare`](https://github.com/cloudflare/zlib), which is zlib licensed
- `libicu` 66.1, which can be found here: <https://github.com/unicode-org/icu/blob/main/icu4c/LICENSE>
- A fork of [`uWebsockets`](https://github.com/jarred-sumner/uwebsockets), which is MIT licensed

For compatibiltiy reasons, these NPM packages are embedded into bun’s binary and injected if imported.

- [`assert`](https://npmjs.com/package/assert) (MIT license)
- [`browserify-zlib`](https://npmjs.com/package/browserify-zlib) (MIT license)
- [`buffer`](https://npmjs.com/package/buffer) (MIT license)
- [`constants-browserify`](https://npmjs.com/package/constants-browserify) (MIT license)
- [`crypto-browserify`](https://npmjs.com/package/crypto-browserify) (MIT license)
- [`domain-browser`](https://npmjs.com/package/domain-browser) (MIT license)
- [`events`](https://npmjs.com/package/events) (MIT license)
- [`https-browserify`](https://npmjs.com/package/https-browserify) (MIT license)
- [`os-browserify`](https://npmjs.com/package/os-browserify) (MIT license)
- [`path-browserify`](https://npmjs.com/package/path-browserify) (MIT license)
- [`process`](https://npmjs.com/package/process) (MIT license)
- [`punycode`](https://npmjs.com/package/punycode) (MIT license)
- [`querystring-es3`](https://npmjs.com/package/querystring-es3) (MIT license)
- [`stream-browserify`](https://npmjs.com/package/stream-browserify) (MIT license)
- [`stream-http`](https://npmjs.com/package/stream-http) (MIT license)
- [`string_decoder`](https://npmjs.com/package/string_decoder) (MIT license)
- [`timers-browserify`](https://npmjs.com/package/timers-browserify) (MIT license)
- [`tty-browserify`](https://npmjs.com/package/tty-browserify) (MIT license)
- [`url`](https://npmjs.com/package/url) (MIT license)
- [`util`](https://npmjs.com/package/util) (MIT license)
- [`vm-browserify`](https://npmjs.com/package/vm-browserify) (MIT license)

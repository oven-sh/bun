Bun itself is MIT-licensed.

## JavaScriptCore

Bun statically links JavaScriptCore (and WebKit) which is LGPL-2 licensed. WebCore files from WebKit are also licensed under LGPL2. Per LGPL2:

> (1) If you statically link against an LGPL’d library, you must also provide your application in an object (not necessarily source) format, so that a user has the opportunity to modify the library and relink the application.

You can find the patched version of WebKit used by Bun here: <https://github.com/oven-sh/webkit>. If you would like to relink Bun with changes:

- `git clone https://github.com/oven-sh/WebKit vendor/WebKit`
- `bun sync-webkit-source` (checks out the version pinned in `WEBKIT_VERSION` in `scripts/build/deps/webkit.ts`)
- `bun run build:local`

This compiles JavaScriptCore, compiles Bun’s `.cpp` bindings for JavaScriptCore (which are the object files using JavaScriptCore) and outputs a new `bun` binary with your changes.

## Linked libraries

Bun statically links these libraries:

| Library | License |
|---------|---------|
| [`boringssl`](https://boringssl.googlesource.com/boringssl/) | [several licenses](https://boringssl.googlesource.com/boringssl/+/refs/heads/master/LICENSE) |
| [`brotli`](https://github.com/google/brotli) | MIT |
| [`libarchive`](https://github.com/libarchive/libarchive) | [several licenses](https://github.com/libarchive/libarchive/blob/master/COPYING) |
| [`lol-html`](https://github.com/cloudflare/lol-html/tree/master/c-api) | BSD 3-Clause |
| [`ls-hpack`](https://github.com/litespeedtech/ls-hpack) | MIT |
| [`ls-qpack`](https://github.com/litespeedtech/ls-qpack) | MIT |
| [`lsquic`](https://github.com/litespeedtech/lsquic) | MIT (portions derived from [Chromium proto-quic](https://github.com/litespeedtech/lsquic/blob/master/LICENSE.chrome), BSD 3-Clause) |
| [`mimalloc`](https://github.com/microsoft/mimalloc) | MIT |
| [`picohttp`](https://github.com/h2o/picohttpparser) | dual-licensed under the Perl License or the MIT License |
| [`zstd`](https://github.com/facebook/zstd) | dual-licensed under the BSD License or GPLv2 license |
| [`simdutf`](https://github.com/simdutf/simdutf) | Apache 2.0 |
| [`tinycc`](https://github.com/tinycc/tinycc) | LGPL v2.1 |
| [`uSockets`](https://github.com/uNetworking/uSockets) | Apache 2.0 |
| [`zlib-ng`](https://github.com/zlib-ng/zlib-ng) | zlib |
| [`c-ares`](https://github.com/c-ares/c-ares) | MIT licensed |
| [`libicu`](https://github.com/unicode-org/icu) 78 | [license here](https://github.com/unicode-org/icu/blob/main/icu4c/LICENSE) |
| [`libbase64`](https://github.com/aklomp/base64/blob/master/LICENSE) | BSD 2-Clause |
| [`libuv`](https://github.com/libuv/libuv) (on Windows) | MIT |
| [`libdeflate`](https://github.com/ebiggers/libdeflate) | MIT |
| [`libjpeg-turbo`](https://github.com/libjpeg-turbo/libjpeg-turbo) | [BSD 3-Clause / IJG / zlib](https://github.com/libjpeg-turbo/libjpeg-turbo/blob/main/LICENSE.md) |
| [`libspng`](https://github.com/randy408/libspng) | BSD 2-Clause |
| [`libwebp`](https://github.com/webmproject/libwebp) | BSD 3-Clause |
| [`highway`](https://github.com/google/highway) | Apache 2.0 |
| [`uucode`](https://github.com/jacobsandlund/uucode) | MIT |
| A fork of [`uWebsockets`](https://github.com/jarred-sumner/uwebsockets) | Apache 2.0 licensed |
| Parts of [Tigerbeetle's IO code](https://github.com/tigerbeetle/tigerbeetle/blob/532c8b70b9142c17e07737ab6d3da68d7500cbca/src/io/windows.zig#L1) | Apache 2.0 licensed |
| `__cxa_thread_atexit` fallback from [LLVM libc++abi](https://github.com/llvm/llvm-project/blob/llvmorg-19.1.0/libcxxabi/src/cxa_thread_atexit.cpp) | Apache 2.0 with LLVM exception |
| The type checker behind `bun check` is a port of [`typescript-go`](https://github.com/microsoft/typescript-go), and uses TypeScript's diagnostic messages and `lib.*.d.ts` files | Apache 2.0 |
| The linter behind `bun lint` is a port of [ESLint](https://github.com/eslint/eslint): its rules, its code path analysis, its configuration and its messages | MIT |
| The TypeScript rules of `bun lint`, their scope analysis and their helpers for types are a port of [`typescript-eslint`](https://github.com/typescript-eslint/typescript-eslint) | MIT |
| The scope analysis of `bun lint` follows [`eslint-scope`](https://github.com/eslint/js/tree/main/packages/eslint-scope) | BSD 2-Clause |
| The selectors of `bun lint` are a port of [`esquery`](https://github.com/estools/esquery) | BSD 3-Clause |
| `bun lint` has ports of [`@eslint-community/regexpp`](https://github.com/eslint-community/regexpp), [`@eslint-community/eslint-utils`](https://github.com/eslint-community/eslint-utils), [`ts-api-utils`](https://github.com/JoshuaKGoldberg/ts-api-utils), [`levn`](https://github.com/gkz/levn) and [`natural-compare`](https://github.com/litejs/natural-compare-lite), reports invalid options the way [`ajv`](https://github.com/ajv-validator/ajv) does, and uses the lists of [`globals`](https://github.com/sindresorhus/globals) | MIT |
| The modes of `src/glob` for the patterns of other tools follow [`minimatch`](https://github.com/isaacs/minimatch) | Blue Oak 1.0.0 |
| and are ports of [`brace-expansion`](https://github.com/juliangruber/brace-expansion), [`picomatch`](https://github.com/micromatch/picomatch), [`ignore`](https://github.com/kaelzhang/node-ignore), [`is-glob`](https://github.com/micromatch/is-glob) and [`is-extglob`](https://github.com/jonschlinkert/is-extglob), and of the way [`globset` and `ignore`](https://github.com/BurntSushi/ripgrep) read a line of an ignore file | MIT |
| and of [`glob-parent`](https://github.com/gulpjs/glob-parent) | ISC |
| The rules of plugins that are built into `bun lint` are ports from [`eslint-plugin-react-hooks`](https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks), [`eslint-plugin-import`](https://github.com/import-js/eslint-plugin-import), [`eslint-plugin-n`](https://github.com/eslint-community/eslint-plugin-n), [`eslint-plugin-es-x`](https://github.com/eslint-community/eslint-plugin-es-x), [`eslint-plugin-react`](https://github.com/jsx-eslint/eslint-plugin-react) with [`jsx-ast-utils`](https://github.com/jsx-eslint/jsx-ast-utils), [`eslint-plugin-prettier`](https://github.com/prettier/eslint-plugin-prettier) with [`prettier-linter-helpers`](https://github.com/prettier/prettier-linter-helpers), and [`oxlint`](https://github.com/oxc-project/oxc) | MIT |
| How the rule `prettier/prettier` cuts the difference between two texts into reports follows [`fast-diff`](https://github.com/jhchen/fast-diff) | Apache 2.0 |
| What the rules of `eslint-plugin-react` ask of ESLint's older API (`isSpaceBetweenTokens`, `getJSDocComment`) follows [`@eslint/compat`](https://github.com/eslint/rewrite/tree/main/packages/compat) | Apache 2.0 |
| The rules of `unicorn`, `oxc`, `react`, `react-perf`, `jsx-a11y`, `nextjs`, `import`, `promise`, `node`, `jest`, `vitest`, `vue` and `jsdoc` that `bun lint` has with a configuration of oxlint are ports of the rules of [`oxlint`](https://github.com/oxc-project/oxc), which are ports from [`eslint-plugin-unicorn`](https://github.com/sindresorhus/eslint-plugin-unicorn), [`eslint-plugin-react`](https://github.com/jsx-eslint/eslint-plugin-react), [`eslint-plugin-react-perf`](https://github.com/cvazac/eslint-plugin-react-perf), [`eslint-plugin-jsx-a11y`](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y), [`@next/eslint-plugin-next`](https://github.com/vercel/next.js/tree/canary/packages/eslint-plugin-next), [`eslint-plugin-import`](https://github.com/import-js/eslint-plugin-import), [`eslint-plugin-n`](https://github.com/eslint-community/eslint-plugin-n), [`eslint-plugin-jest`](https://github.com/jest-community/eslint-plugin-jest), [`@vitest/eslint-plugin`](https://github.com/vitest-dev/eslint-plugin-vitest) and [`eslint-plugin-vue`](https://github.com/vuejs/eslint-plugin-vue) | MIT |
| and from [`eslint-plugin-promise`](https://github.com/eslint-community/eslint-plugin-promise) | ISC |
| and from [`eslint-plugin-jsdoc`](https://github.com/gajus/eslint-plugin-jsdoc) | BSD 3-Clause |
| How `bun lint` and `bun format` take a JSDoc comment apart follows [`oxc_jsdoc`](https://github.com/oxc-project/oxc/tree/main/crates/oxc_jsdoc) | MIT |
| The formatter behind `bun format` implements [Prettier](https://github.com/prettier/prettier). Its rules for JavaScript and TypeScript are a port of [`oxc_formatter`](https://github.com/oxc-project/oxc/tree/main/crates/oxc_formatter) | MIT |
| The intermediate representation and the printer of `bun format` come from [Biome](https://github.com/biomejs/biome) | MIT or Apache 2.0 |
| The CSS, Less and SCSS parsers of `bun format` follow [`postcss`](https://github.com/postcss/postcss), [`postcss-less`](https://github.com/shellscape/postcss-less), [`postcss-scss`](https://github.com/postcss/postcss-scss), [`postcss-selector-parser`](https://github.com/postcss/postcss-selector-parser), [`postcss-media-query-parser`](https://github.com/dryoma/postcss-media-query-parser) and [`postcss-value-parser`](https://github.com/TrySound/postcss-value-parser) | MIT |
| The import sorting of `bun format` is a port of [`@trivago/prettier-plugin-sort-imports`](https://github.com/trivago/prettier-plugin-sort-imports) and [`@ianvs/prettier-plugin-sort-imports`](https://github.com/ianvs/prettier-plugin-sort-imports) | Apache 2.0 |
| `bun format` also has ports of [`prettier-plugin-organize-imports`](https://github.com/simonhaenisch/prettier-plugin-organize-imports), parts of [`@babel/generator`](https://github.com/babel/babel), [`sort-package-json`](https://crates.io/crates/sort-package-json), [`jest-docblock`](https://github.com/jestjs/jest/tree/main/packages/jest-docblock), and tables that follow [`emoji-regex`](https://github.com/mathiasbynens/emoji-regex) and [`get-east-asian-width`](https://github.com/sindresorhus/get-east-asian-width) | MIT |
| The Svelte printer of `bun format` is a port of [`prettier-plugin-svelte`](https://github.com/sveltejs/prettier-plugin-svelte) | MIT |

## Polyfills

For compatibility reasons, the following packages are embedded into Bun's binary and injected if imported.

| Package | License |
|---------|---------|
| [`acorn`](https://github.com/acornjs/acorn) | MIT |
| [`acorn-walk`](https://github.com/acornjs/acorn) | MIT |
| [`assert`](https://npmjs.com/package/assert) | MIT |
| [`browserify-zlib`](https://npmjs.com/package/browserify-zlib) | MIT |
| [`buffer`](https://npmjs.com/package/buffer) | MIT |
| [`constants-browserify`](https://npmjs.com/package/constants-browserify) | MIT |
| [`crypto-browserify`](https://npmjs.com/package/crypto-browserify) | MIT |
| [`domain-browser`](https://npmjs.com/package/domain-browser) | MIT |
| [`events`](https://npmjs.com/package/events) | MIT |
| [`https-browserify`](https://npmjs.com/package/https-browserify) | MIT |
| [`os-browserify`](https://npmjs.com/package/os-browserify) | MIT |
| [`path-browserify`](https://npmjs.com/package/path-browserify) | MIT |
| [`process`](https://npmjs.com/package/process) | MIT |
| [`punycode`](https://npmjs.com/package/punycode) | MIT |
| [`querystring-es3`](https://npmjs.com/package/querystring-es3) | MIT |
| [`stream-browserify`](https://npmjs.com/package/stream-browserify) | MIT |
| [`stream-http`](https://npmjs.com/package/stream-http) | MIT |
| [`string_decoder`](https://npmjs.com/package/string_decoder) | MIT |
| [`timers-browserify`](https://npmjs.com/package/timers-browserify) | MIT |
| [`tty-browserify`](https://npmjs.com/package/tty-browserify) | MIT |
| [`url`](https://npmjs.com/package/url) | MIT |
| [`util`](https://npmjs.com/package/util) | MIT |
| [`vm-browserify`](https://npmjs.com/package/vm-browserify) | MIT |

## Additional credits

- Bun's JS transpiler, CSS lexer, and Node.js module resolver source code is a port of [@evanw](https://github.com/evanw)’s [esbuild](https://github.com/evanw/esbuild) project.
- Credit to [@kipply](https://github.com/kipply) for the name "Bun"!
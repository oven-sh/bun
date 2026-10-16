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
| The type checker behind `bun check` and the parser it shares with `bun lint` and `bun fmt` are ports of [`typescript-go`](https://github.com/microsoft/typescript-go). They use TypeScript's diagnostic messages and `lib.*.d.ts` files | Apache 2.0 |
| `bun lint` ports large parts of [ESLint](https://github.com/eslint/eslint): code path analysis, rule helpers such as `ast-utils.js`, config and comment handling, and many rules. The ESLint rules in `bun lint` use ESLint's rule names, options, option schemas, messages and descriptions. The `eslint:recommended` and `eslint:all` presets are ESLint's. Parts of `main.js` in `src/lint/js_plugin/worker` are copied from ESLint, and parts of `LintReport.cpp`, `LintSourceCode.cpp` and `LintTokens.cpp` in `src/jsc/bindings` are ported from it | MIT |
| `bun lint` does the same with the rules of [`typescript-eslint`](https://github.com/typescript-eslint/typescript-eslint). It also ports `type-utils` and the plugin's `util` helpers, and uses its presets, the error messages of `typescript-estree` and the `lib` globals of `scope-manager` | MIT |
| Selectors in `bun lint` are a port of [`esquery`](https://github.com/estools/esquery) | BSD 3-Clause |
| `bun lint` has ports of [`@eslint-community/regexpp`](https://github.com/eslint-community/regexpp), [`@eslint-community/eslint-utils`](https://github.com/eslint-community/eslint-utils), [`levn`](https://github.com/gkz/levn) and [`natural-compare`](https://github.com/litejs/natural-compare-lite), and of parts of [`ts-api-utils`](https://github.com/JoshuaKGoldberg/ts-api-utils) and [`@eslint/eslintrc`](https://github.com/eslint/eslintrc) | MIT |
| `bun lint` uses the error messages of [`ajv`](https://github.com/ajv-validator/ajv), [`acorn`](https://github.com/acornjs/acorn) and [`optionator`](https://github.com/gkz/optionator), and the lists in [`globals`](https://github.com/sindresorhus/globals) and [`is-core-module`](https://github.com/inspect-js/is-core-module) | MIT |
| `bun lint` uses the error messages of [`espree`](https://github.com/eslint/js/tree/main/packages/espree) | BSD 2-Clause |
| `bun lint` uses the `JSON.parse` error messages of [V8](https://github.com/v8/v8) | BSD 3-Clause |
| `bun lint` has ports of parts of [`@eslint/plugin-kit`, `@eslint/config-array`, `@eslint/config-helpers` and `@eslint/compat`](https://github.com/eslint/rewrite) | Apache 2.0 |
| `bun lint` and `bun fmt` have a port of the pattern-to-regular-expression table of [`ignore`](https://github.com/kaelzhang/node-ignore) | MIT |
| `bun lint` and `bun fmt` have ports of [`is-glob`](https://github.com/micromatch/is-glob) and [`is-extglob`](https://github.com/jonschlinkert/is-extglob) | MIT |
| `bun lint` and `bun fmt` have a port of [`glob-parent`](https://github.com/gulpjs/glob-parent) | ISC |
| The `react-hooks`, `import`, `n`, `react` and `prettier` rules in `bun lint` are ports of the rules in [`eslint-plugin-react-hooks`](https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks), [`eslint-plugin-import`](https://github.com/import-js/eslint-plugin-import), [`eslint-plugin-n`](https://github.com/eslint-community/eslint-plugin-n), [`eslint-plugin-es-x`](https://github.com/eslint-community/eslint-plugin-es-x), [`eslint-plugin-react`](https://github.com/jsx-eslint/eslint-plugin-react) and [`eslint-plugin-prettier`](https://github.com/prettier/eslint-plugin-prettier), with the same rule names, options and messages. They include the Node.js version tables of `eslint-plugin-n` and a few functions from [`jsx-ast-utils`](https://github.com/jsx-eslint/jsx-ast-utils) and [`prettier-linter-helpers`](https://github.com/prettier/prettier-linter-helpers) | MIT |
| The text diff used by `bun test` and the `prettier/prettier` rule has parts of [`diff-match-patch`](https://github.com/google/diff-match-patch) and of [`fast-diff`](https://github.com/jhchen/fast-diff), which is derived from it | Apache 2.0 |
| The `unicorn`, `oxc`, `react-perf`, `jsx-a11y`, `nextjs`, `promise`, `node`, `jest` and `vitest` rules in `bun lint` are ports of the rules in [`oxlint`](https://github.com/oxc-project/oxc), with its messages and help text. With an oxlint config, the other rules use the messages of oxlint and [`tsgolint`](https://github.com/oxc-project/tsgolint) too. `bun lint` also ports parts of `oxc_jsdoc` and `oxc_react_compiler` | MIT |
| oxlint ported those rules from [`eslint-plugin-unicorn`](https://github.com/sindresorhus/eslint-plugin-unicorn), [`eslint-plugin-react-perf`](https://github.com/cvazac/eslint-plugin-react-perf), [`eslint-plugin-jsx-a11y`](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y), [`@next/eslint-plugin-next`](https://github.com/vercel/next.js/tree/canary/packages/eslint-plugin-next), [`eslint-plugin-n`](https://github.com/eslint-community/eslint-plugin-n), [`eslint-plugin-jest`](https://github.com/jest-community/eslint-plugin-jest) and [`@vitest/eslint-plugin`](https://github.com/vitest-dev/eslint-plugin-vitest). Their rule names, options and some of their messages are in `bun lint` | MIT |
| oxlint ported its `promise` rules from [`eslint-plugin-promise`](https://github.com/eslint-community/eslint-plugin-promise) | ISC |
| The ARIA tables of the `jsx-a11y` rules come from [`aria-query`](https://github.com/A11yance/aria-query) by way of oxlint | Apache 2.0 |
| `bun fmt` is a port of [Prettier](https://github.com/prettier/prettier): its printers for CSS, SCSS, Less, HTML, Vue, Angular, Markdown, YAML, GraphQL and Handlebars, its document printer, its handling of options, pragmas, ranges, cursor offsets and embedded code, and the HTML tables it is built with | MIT |
| The JavaScript and TypeScript printer of `bun fmt`, its JSDoc formatting and its oxfmt-style import sorting are a port of [`oxc_formatter`](https://github.com/oxc-project/oxc/tree/main/crates/oxc_formatter), which is a port of the [Biome](https://github.com/biomejs/biome) formatter. The intermediate representation and its printer come from Biome by way of `oxc_formatter_core` | MIT |
| `bun fmt` has ports of the parsers in [`postcss`](https://github.com/postcss/postcss), [`postcss-scss`](https://npmjs.com/package/postcss-scss), [`postcss-less`](https://npmjs.com/package/postcss-less), [`postcss-selector-parser`](https://github.com/postcss/postcss-selector-parser), [`postcss-media-query-parser`](https://github.com/dryoma/postcss-media-query-parser), [`postcss-values-parser`](https://npmjs.com/package/postcss-values-parser), [`angular-html-parser`](https://npmjs.com/package/angular-html-parser), [`graphql-js`](https://github.com/graphql/graphql-js), [`@glimmer/syntax`](https://github.com/glimmerjs/glimmer-vm), [`simple-html-tokenizer`](https://github.com/tildeio/simple-html-tokenizer) and [`@angular/compiler`](https://github.com/angular/angular), and of parts of [`yaml-unist-parser`](https://npmjs.com/package/yaml-unist-parser) and [`angular-estree-parser`](https://npmjs.com/package/angular-estree-parser) | MIT |
| `bun fmt` also has a port of [`@handlebars/parser`](https://github.com/handlebars-lang/handlebars-parser) and of one file of [`yaml`](https://npmjs.com/package/yaml) | ISC |
| Import sorting in `bun fmt` has ports of [`@trivago/prettier-plugin-sort-imports`](https://github.com/trivago/prettier-plugin-sort-imports) and [`@ianvs/prettier-plugin-sort-imports`](https://github.com/ianvs/prettier-plugin-sort-imports), and of `organizeImports.ts` in [TypeScript](https://github.com/microsoft/TypeScript) | Apache 2.0 |
| `bun fmt` has ports of [`jest-docblock`](https://github.com/jestjs/jest/tree/main/packages/jest-docblock) and the crates [`sort-package-json`](https://crates.io/crates/sort-package-json) and [`oxc-toml`](https://crates.io/crates/oxc-toml) (a fork of taplo), and of parts of [`@babel/generator`](https://github.com/babel/babel), [`micromark`](https://github.com/micromark/micromark) and [`editorconfig-without-wasm`](https://github.com/fisker/editorconfig-core-js-without-wasm). Its character width tables are generated from [`emoji-regex`](https://github.com/mathiasbynens/emoji-regex), [`get-east-asian-width`](https://github.com/sindresorhus/get-east-asian-width) and [`narrow-emojis`](https://npmjs.com/package/narrow-emojis) | MIT |
| Tailwind class sorting in `bun fmt` is a port of parts of [`prettier-plugin-tailwindcss`](https://github.com/tailwindlabs/prettier-plugin-tailwindcss) | MIT |
| Svelte formatting in `bun fmt` is a port of [`prettier-plugin-svelte`](https://github.com/sveltejs/prettier-plugin-svelte) and of the template parser of [Svelte](https://github.com/sveltejs/svelte) | MIT |

The tests in `test/cli/lint/conformance` and `test/cli/format` include test cases from ESLint, typescript-eslint, the ESLint plugins above, oxc, tsgolint, Prettier and the two import sorting plugins. They are not part of the `bun` binary. Their licenses are next to them.

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
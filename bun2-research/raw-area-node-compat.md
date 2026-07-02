# Bun 2.0 candidates - intentional divergences from Node.js

All behaviors below were reproduced on `bun 1.4.0-canary` vs `node v26.3.0` inside the repo
checkout at `/workspace/bun`. Every finding cites a file:line, an issue number, or a verbatim
quote. Ordered strongest-first.

---

### `__esModule` default-import unwrapping (team has already called it a mistake)

what: When an ES module default-imports a CommonJS file that sets `exports.__esModule = true` *and* `exports.default`, Bun gives `exports.default`; Node.js always gives the whole `module.exports`.
where: `/workspace/bun/src/jsc/bindings/JSCommonJSModule.cpp:975-1002` (the full rationale comment block); `/workspace/bun/src/js/builtins/CommonJS.ts:120-135`; asserted by `test/js/bun/resolve/esModule-annotation.test.js`.
evidence:
- Issue **#9267** ("Remove workaround for `__esModule`"), OPEN, labeled `breaking`, filed by Bun maintainer Electroid: *"This has just caused more issues than it solved, will be removed in Bun 1.1."* It was never removed.
- Issue **#32698** ("Default import of a bare CommonJS package with `__esModule` returns `exports.default` instead of the namespace (differs from Node)") closed NOT_PLANNED with the bot note: *"the behavior is intentional and is asserted by existing tests ... a documented divergence from Node's ESM/CJS interop."* (It is in fact NOT documented: `grep -r __esModule docs/` returns nothing.)
- Source comment at `JSCommonJSModule.cpp:989`: *"Note that this interpretation is slightly different ... We do not ignore when \"type\": \"module\" or when the file extension is \".mjs\"."*
- Reproduced: `import d from "./cjs.cjs"` where `cjs.cjs` has `__esModule` + `default` gives `"DEFAULT_EXPORT"` in Bun and `{"default":"DEFAULT_EXPORT","named":"NAMED"}` in Node.
why bad: It silently changes what `default` means for thousands of Babel/tsc-transpiled CJS packages - code works in one runtime and breaks in the other. The team has publicly said it "caused more issues than it solved" and tagged it `breaking`, but never shipped the fix because it is backwards-incompatible. Related fallout: #3881, #18615, #29304.
bun 2.0 proposal: Adopt Node's semantics (`default` is always `module.exports`) and delete the `__esModule` annotation special-case from `populateESMExports` and `requireESM`.
blast radius: high - any Bun code that default-imports Babel/tsc-compiled CJS changes shape; but it aligns with Node and esbuild-as-runtime would match what the ecosystem already tests against.
confidence: high.

### Bun silently replaces published npm packages with its own shims (`ws`, `undici`, `node-fetch`, …)

what: At runtime Bun hardcodes the bare specifiers `ws`, `undici`, `node-fetch`, `isomorphic-fetch`, `@vercel/fetch`, `utf-8-validate`, `abort-controller`, bare `ffi`, `ws/lib/websocket`, `abort-controller/polyfill`, and even Next.js internals `next/dist/compiled/{ws,node-fetch,undici}` to Bun's own built-in implementations, **ignoring the version the user installed in `node_modules`**.
where: `/workspace/bun/src/resolve_builtins/HardcodedModule.rs:704-771` (comment: `// Thirdparty packages we override`); shims in `/workspace/bun/src/js/thirdparty/` (`ws.js` header: *"Mocking https://github.com/websockets/ws"*). Applied only in `BUN_EXTRA_ALIAS_KVS` (`HardcodedModule.rs:798`), i.e. the Bun runtime target.
evidence:
- Reproduced: with a real `node_modules/ws@99.0.0` and `node_modules/undici@99.0.0` installed, `require("ws")` and `require("undici")` still return Bun's shims. `require.resolve("ws")` returns the literal string `"ws"`, not a filesystem path. Meanwhile `require("ws/package.json").version` returns `"99.0.0"` from the *real* package - so version probes and the implementation disagree.
- Bare `require("ffi")` returns `bun:ffi` (`CFunction, CString, FFIType, …`) even when the npm `ffi` package is installed - a completely different API.
- Issue **#17799** "Remove the undici polyfill" (open, `good first issue`). Shim-incompleteness issues: **#7920** (`undici.Pool.request` missing, breaks `@elastic/elasticsearch`), **#27783** (`cacheStores` export missing), **#14498** (`undici.Agent.close` missing), **#21492**, **#25481**, **#21944**, **#19748** ("Undici native module is outdated"), **#19688** / **#31760** (`ws` shim bugs).
- Not documented anywhere in `docs/` - `grep -rn "node-fetch\|undici" docs/` returns nothing. The only mention is the internal `src/js/CLAUDE.md:10`.
why bad: The user's lockfile says one thing; the runtime loads another. There is no opt-out. It silently breaks any code relying on a specific `ws`/`undici` version, undici's `MockAgent`/interceptors/`setGlobalDispatcher`, `require.resolve("ws")`, or the real `ffi` package. Hijacking `next/dist/compiled/*` paths is a time bomb tied to Next.js internals.
bun 2.0 proposal: Remove the npm-package aliases from `BUN_EXTRA_ALIAS_KVS` (or gate them behind an opt-in like `bunfig.toml [run] polyfillNpmPackages = true`). Keep only `node:*` builtins hardcoded. At minimum, drop the `next/dist/compiled/*` and bare-`ffi` entries.
blast radius: medium - the shims exist to make popular packages "just work" without the native bits, but `bun install` already installs the real packages; most users would not notice the swap back.
confidence: high.

### Module format decided by content sniffing - `"type"`, `.mjs`, `.cjs` are ignored

what: Bun decides CommonJS-vs-ESM by scanning a file's syntax (presence of `import`/`export` → ESM; else `require`/`__dirname`/`__filename`/`"use strict"` at top → CJS; else ESM). It ignores `package.json` `"type"` and the `.mjs`/`.cjs` extensions that Node uses as the source of truth.
where: `/workspace/bun/src/js_parser/parse/parse_entry.rs:1736-1781` - the comment reads verbatim: *"Divergence from esbuild and Node.js: we default to ESM when there are no exports. However, this breaks certain packages."* Default loader table: `.mjs`/`.cjs` → `Loader::Js` at `/workspace/bun/src/bundler/options.rs:699-700`. User-facing admission: `docs/runtime/module-resolution.mdx:314`: *"When Bun's JavaScript transpiler detects usages of `module.exports`, it treats the file as CommonJS."*
evidence (all reproduced):
- `"type":"module"` package, `"use strict"; console.log(typeof module)` in a `.js` file → Bun prints `object` (CJS), Node prints `undefined` (ESM). Top-level `this` differs too.
- `"type":"module"` package, `module.exports = {...}` in a `.js` file → works in Bun; `ReferenceError: module is not defined in ES module scope` in Node.
- `foo.mjs` containing `module.exports = …` and no import/export → CJS in Bun, SyntaxError in Node.
- `foo.cjs` containing `import.meta.url` → works in Bun, SyntaxError in Node (**#27425**, closed as a duplicate).
- `"type":"commonjs"` package, `.js` file with `export const` → works in Bun, errors in Node.
- In a real Bun ES module, `require`, `__dirname`, `__filename` are all defined (transpiler desugars them to `import.meta.*`); in Node ESM all three throw. Breaks the ubiquitous `typeof require === "function"` / `typeof __dirname === "undefined"` CJS-vs-ESM feature-detection idiom.
- Issue **#18584** (`.mjs` treated as CJS), **#27425**, **#32057** (named exports lost when heuristic flips to CJS).
why bad: The same file has different module semantics (different `this`, different globals, different export object, different error behavior) depending only on which runtime loads it. `"use strict";` - a legal no-op in ESM - flips the format. This is the root cause of an entire class of "works in Bun, breaks in Node" bugs, and it is the one divergence that makes code *written for* Bun non-portable.
bun 2.0 proposal: Honor `.mjs`/`.cjs` and `package.json` `"type"` as Node does; keep sniffing only as the fallback for the truly ambiguous `.js`-with-no-`type` case. Stop defining `__dirname`/`__filename`/`require` in ESM (or at least stop making `"use strict"` a CJS signal).
blast radius: high - a lot of Bun-only code depends on the leniency; but this is exactly the kind of thing a major version exists for, and it is the one change that most improves Node portability.
confidence: high.

### `require()`/`import()` throw `ResolveMessage`/`BuildMessage`, which are not `Error`s

what: Module-not-found and parse failures from `require()`/`import()` throw Bun's `ResolveMessage`/`BuildMessage` classes, which do not extend `Error` and whose `message` text differs from Node's.
where: `/workspace/bun/src/jsc/ResolveMessage.rs`, `/workspace/bun/src/jsc/BuildMessage.rs`; exposed as globals via `/workspace/bun/src/jsc/bindings/ZigGlobalObject.lut.txt:36-42`; typed at `packages/bun-types/globals.d.ts:998,1021`.
evidence (reproduced):
- `require("nope")` → Bun: `instanceof Error === false`, prototype chain `ResolveMessage -> Object`, `name === "ResolveMessage"`, no own `stack`/`message`/`requireStack` properties, message `"Cannot find package 'nope' from '…'"` . Node: `instanceof Error === true`, `name === "Error"`, own `requireStack`, message `"Cannot find module 'nope'"`.
- `require("/tmp/syn.js")` (syntax error) → Bun: `BuildMessage`, `instanceof SyntaxError === false`. Node: `SyntaxError`.
- The `.code` values (`MODULE_NOT_FOUND` / `ERR_MODULE_NOT_FOUND`) *do* match, but nothing else does.
- Issue **#7531** "BuildMessage/ResolveMessage should extend `Error`" (OPEN, `bug`, filed by then-Bun-team member paperclover). Fallout: **#9919** ("ResolveMessage message property read-only status breaks ESLint error feedback"), **#6730**, **#6555**.
why bad: `err instanceof Error`, `err.name === "Error"`, `err.stack`, `err.requireStack`, and the very common `/^Cannot find module '(.+)'/` regex (Express view loading, `optional-require`, jest resolvers, webpack) all misbehave. Exception-reporting libraries (Sentry etc.) special-case non-Error throwables.
bun 2.0 proposal: Make `ResolveMessage extends Error` and `BuildMessage extends SyntaxError` (or throw plain `Error`/`SyntaxError` from module loading and keep the rich classes for `Bun.build().logs`), and adopt Node's `"Cannot find module '<x>'"` wording plus `requireStack`.
blast radius: low - nobody depends on `instanceof Error` being *false*; the rich fields can stay.
confidence: high.

### `bun run <script>` executes `#!/usr/bin/env node` binaries with real Node by default

what: When running `package.json` scripts, Bun honors the `node` shebang on `node_modules/.bin` executables and launches the *real* `node` if one is on `PATH`; `--bun` is needed to opt into Bun. The team has wanted to flip this default since before 1.0.
where: `/workspace/bun/src/runtime/cli/run_command.rs:1957-2027` (`found_node` → uses real node; else injects a fake `node` symlink pointing at bun); `--bun` documented at `docs/snippets/cli/run.mdx`: *"Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)."*
evidence:
- Issue **#4464** "Make `--bun` default, introduce `--node`" (OPEN, labeled **`breaking`**, filed by Bun maintainer Electroid): *"Currently, when Bun runs a script with a shebang in package.json, it will default to Node. Before 1.0, we should change this so that it defaults to Bun, and introduce `--node`."*
- Reproduced: `bun run t` (script → a `.bin` tool with `#!/usr/bin/env node`) prints `runner: NODE 26.3.0`; `bun --bun run t` prints `runner: BUN 1.4.0`.
- The mechanism (`--bun` *symlinks `node`* onto `PATH`) is itself a blunt instrument - it redirects every transitive `node` invocation, not just the target.
why bad: Users who installed Bun "to use Bun" silently run their dev servers, CLIs, and build tools on Node; bug reports and perf comparisons are constantly confounded by this (e.g. #11961, #14954, #13797, #25531 are all "… with `--bun`" failures). The `--bun` escape hatch is global process-tree surgery rather than a per-invocation decision.
bun 2.0 proposal: Exactly what #4464 says: make `--bun` the default for `bun run` and add `--node` for the explicit opt-out. Replace the "symlink node" mechanism with per-exec shebang interception.
blast radius: high - flips the runtime for every existing `bun run dev` invocation; but it is already the single most-requested and team-endorsed breaking change.
confidence: high.

### Automatic `.env` / `.env.{development,production,test,local}` loading

what: Every `bun`, `bun run`, `bun test`, `bun install`, and `bunx` invocation automatically reads `.env`, `.env.local`, and `.env.${NODE_ENV||"development"}` from cwd into `process.env`. Node only reads env files with an explicit `--env-file`.
where: `/workspace/bun/src/dotenv/env_loader.rs`; `docs/runtime/environment-variables.mdx`; `Loader::get_node_env` at `env_loader.rs:181` also adds a Bun-only `BUN_ENV` that overrides `NODE_ENV`.
evidence:
- Reproduced: a file `.env` containing `MY_SECRET=fromdotenv` is visible to `bun a.mjs` and invisible to `node a.mjs`.
- Issue **#23967** "Do not automatically read .env files by default" (OPEN, `enhancement`) lists the harms explicitly - *"Is implicit. Makes it harder to switch to bun from node. … Can cause security problems when .env files have sensitive information"* - and links downstream ecosystem bugs `vitejs/vite#14912` and `nestjs/config#1461`.
- Issue **#13377** "Bun shouldn't load .env.development when NODE_ENV isn't set" (OPEN, `bug, docs`) - Bun silently loads `.env.development` when `NODE_ENV` is unset.
- Issue **#6338** "Bun's .env reading causes issues with Vite's .env reading"; **#1564**/**#5515** (requests for an opt-out, eventually shipped as `--no-env-file`); **#31450** (`bun install` still ignores `--no-env-file`/`--env-file`/`env=false`).
why bad: Ambient, implicit, directory-dependent state injection. It double-loads env files in frameworks (Vite, Next, Nest) that manage them themselves, changes behavior of `bun install`/`bunx` run in an untrusted directory, and the `NODE_ENV→development→.env.development` default is a trap even Bun's docs mislabel.
bun 2.0 proposal: Make `.env` loading opt-in (honor Node's `--env-file` flag) for the runtime, and never do it for `bun install`/`bunx`. If it must stay on, drop the `.env.development` default when `NODE_ENV` is unset (#13377).
blast radius: high - auto-`.env` is a flagship DX feature many projects rely on; an explicit `env = true` migration default in bunfig would be needed.
confidence: high (as a documented pain point); medium that the team would fully reverse the default.

### `tsconfig.json` `paths`/`baseUrl` honored at runtime - including tsconfigs inside `node_modules`

what: Bun applies `compilerOptions.paths` and `baseUrl` from the *nearest* `tsconfig.json`/`jsconfig.json` to every resolution at runtime. `baseUrl: "."` turns bare specifiers into project-relative lookups that shadow real npm packages, and a `tsconfig.json` shipped inside a `node_modules` package rewrites that package's own `require()`s.
where: `/workspace/bun/src/resolver/tsconfig_json.rs`; `/workspace/bun/src/resolver/resolver.rs`; documented at `docs/runtime/module-resolution.mdx:286-310`. Tellingly, tsconfig autoload is already **off by default** for `--compile` executables (`/workspace/bun/src/runtime/cli/Arguments.rs:425`: `--compile-autoload-tsconfig … (default: false)`).
evidence (all reproduced):
- Project `tsconfig.json` with `"baseUrl": "."` + a root file `lodash.ts` → `import l from "lodash"` resolves to the local `lodash.ts`, *not* `node_modules/lodash`. Node loads the real package.
- A dependency shipping `node_modules/dep/tsconfig.json` with `"paths": {"@shim/*": ["shim/*"]}` → Bun resolves `require("@shim/x")` inside the dep; Node throws `MODULE_NOT_FOUND`.
- A dependency shipping `node_modules/dep/tsconfig.json` with only `"baseUrl": "."` and a local `lodash.js` → that dep's `require("lodash")` resolves to *its own file* in Bun and to `node_modules/lodash` in Node. A stray published tsconfig silently redirects a package's dependency graph.
- Open issues on the tsconfig runtime machinery: **#14694** ("Bun breaks path aliases on monorepo"), **#3617** ("Path re-mapping does not work in test context"), **#23695**, **#4774**, **#26793**.
why bad: `tsc` itself never applies `paths` at emit, and TypeScript's docs say `paths` is type-checking-only, so Bun creates code that is *impossible to run in Node*. The `node_modules` + `baseUrl` case is a supply-chain-shaped footgun with no opt-out. The team already turned this off for `--compile` - an implicit admission.
bun 2.0 proposal: (a) Stop reading `tsconfig.json` files inside `node_modules` entirely; (b) stop honoring `baseUrl` as a bare-specifier fallback (esbuild warns against it for the same reason); keep `paths`. Ship a `bunfig` / CLI opt-out for the rest.
blast radius: medium - (a) and (b) almost never carry intended behavior; plain `paths` (the popular case) is unaffected.
confidence: high for (a) and (b); medium that the team would drop `paths` entirely.

### `NODE_OPTIONS` is silently ignored; Bun invented `BUN_OPTIONS` instead

what: Bun never reads `NODE_OPTIONS`. It added a parallel, Bun-only `BUN_OPTIONS` variable.
where: `BUN_OPTIONS` declared at `/workspace/bun/src/bun_core/env_var.rs:95`, spliced into argv at `/workspace/bun/src/bun_core/util.rs:4053`. The only `NODE_OPTIONS` reference in the whole runtime is a string-trimming cosmetic in shell completions (`/workspace/bun/src/runtime/cli/run_command.rs:3823`).
evidence:
- Reproduced: `NODE_OPTIONS="--require /tmp/preload.cjs" bun -e …` → preload NOT applied; same command with `node` → applied. `NODE_OPTIONS="--totally-bogus-flag" bun -e …` → no error (Node rejects it).
- Issue **#28817** "Bun not honoring `NODE_OPTIONS=\"--dns-result-order=ipv4first\"`" (OPEN). Issue **#22880** "Debug run configurations inject --debug-brk into NODE_OPTIONS, causing Bun to error" (OPEN, `debugger`). Issue **#26704** (VS Code JS Debug Terminal + Bun) is collateral.
why bad: `NODE_OPTIONS` is *the* standard cross-process injection point - VS Code's JS debug terminal, Datadog/OTel/NewRelic auto-instrumentation, `nyc`, `cross-env` setups, and every container base image use it. Bun silently drops all of them, which is worse than erroring. A second, differently-named env var means tooling must now special-case Bun.
bun 2.0 proposal: Parse `NODE_OPTIONS`, apply the flags Bun supports, and *warn* (not silently ignore) on ones it does not. Keep `BUN_OPTIONS` as the Bun-flags channel.
blast radius: low - today it is a no-op, so honoring it only changes behavior for people who set it expecting it to work.
confidence: high that it diverges; medium that the team treats it as a regret rather than "not yet implemented."

### Bun ships Node APIs that Node.js has already removed

what: Bun exports legacy APIs Node removed years ago: `util.isBoolean/isBuffer/isDate/isError/isFunction/isNull/isNullOrUndefined/isNumber/isObject/isPrimitive/isRegExp/isString/isSymbol/isUndefined/log` (removed in Node 23), `fs.F_OK/R_OK/W_OK/X_OK` top-level (removed in Node 20), `tls.parseCertString` (end-of-life DEP0076), `net._setSimultaneousAccepts` (removed, DEP0121).
where: `/workspace/bun/src/js/node/util.ts:351` - verbatim comment: `// Deprecated in Node.js 22, removed in 23` right above the exports that Bun nonetheless ships.
evidence: Reproduced - `typeof require("util").isBoolean` is `"function"` in Bun, `"undefined"` in Node v26. `require("fs").F_OK === 0` in Bun, `undefined` in Node. `tls.parseCertString` and `net._setSimultaneousAccepts` are functions in Bun, `undefined` in Node. `docs/runtime/nodejs-compat.mdx:10` claims compatibility with *"Node.js v23"* - where these do not exist.
why bad: It makes "works in Bun" diverge from "works in Node v20+" in the direction nobody wants, and it keeps the known-security-hazard APIs (the `util.is*` family) alive. These are zero-cost deletions.
bun 2.0 proposal: Remove them, matching the Node version Bun declares compat with. Gate them behind a `--no-deprecation`-style compat flag if anything.
blast radius: low - Node already removed them; any package hit by this is already broken on current Node.
confidence: high.

### Non-standard properties bolted onto Node classes and `process`

what: Bun adds properties to standard Node objects that Node does not have, several explicitly marked as kept only for backwards compatibility.
where / evidence:
- `http.OutgoingMessage.prototype.headers` (getter *and* setter) - `/workspace/bun/src/js/node/_http_outgoing.ts:1112-1113`: *"Bun-specific accessor: the same contract as the deprecated `_headers`, kept because existing code reads and assigns res.headers on outgoing messages."* Also `/workspace/bun/src/js/node/_http_server.ts:1732`: *"res.headers / res.headers= are Bun-specific conveniences kept for backwards compatibility."* Reproduced: `"headers" in http.OutgoingMessage.prototype` is `true` in Bun, `false` in Node.
- `process.browser` (hardcoded `false`), `process.isBun` (`true`), `process.revision` - `/workspace/bun/src/jsc/bindings/BunProcess.cpp:2951,2961,2966`; LUT at BunProcess.cpp:4396,4419. None exist in Node.
- `process.connected` is `false` without IPC in Bun; `undefined` in Node.
why bad: `res.headers` is the semantics of Node's *deprecated* `_headers` (DEP0066); exposing it as the un-prefixed name legitimizes a removed API and confuses code that treats `.headers` as the marker of an `IncomingMessage`. `process.browser` is a browserify/webpack define, not a runtime property - setting it to a real `false` interacts badly with bundlers that `define` it.
bun 2.0 proposal: Remove `OutgoingMessage#headers`, `process.browser`, and `process.connected !== undefined`-when-no-IPC. Keep `process.isBun`/`process.revision` (harmless additive) but document them as Bun-only.
blast radius: low - `res.headers` has `res.getHeaders()` as the 1-line replacement.
confidence: high.

### Deprecated globals and `import.meta` aliases Bun's own docs call aliases

what: Duplicated/renamed API surface kept only for older-Bun compatibility.
where / evidence:
- `BuildError` / `ResolveError` globals are aliases of `BuildMessage` / `ResolveMessage` - `/workspace/bun/src/jsc/bindings/ZigGlobalObject.lut.txt:36,41` (both names point at the same structure) and `packages/bun-types/deprecated.d.ts:176-184` (`@deprecated Renamed to …`).
- `import.meta.dir`, `import.meta.path`, `import.meta.file` are the Bun-original names; `import.meta.dirname` / `import.meta.filename` (the names Node.js standardized in 20.11) are documented in Bun as *"An alias to import.meta.dir, for Node.js compatibility"* (`docs/runtime/module-resolution.mdx:353,357`) - i.e. Bun treats the industry-standard names as the alias.
- `import.meta.resolveSync` is already `@deprecated` in `packages/bun-types/globals.d.ts:1326`. `import.meta.require` is documented in the same file as *"This API is not stable and may change or be removed."*
- `import.meta.env === process.env === Bun.env` (reproduced) - three names for one object; also it clashes with Vite's `import.meta.env` (which is filtered/prefixed), so isomorphic code that expects only `VITE_*` keys suddenly sees every secret.
- `packages/bun-types/deprecated.d.ts` is an entire file of such aliases (`readableStreamToBytes/Text/Json/Blob`, `TLSOptions.keyFile/certFile/caFile`, `ShellFunction`, `Errorlike`, …).
why bad: Every alias is a second name users discover, ask about, and write incompatible code against. The `dir`/`dirname` inversion is backwards: the Node-standard names are the ones the ecosystem uses.
bun 2.0 proposal: Remove `BuildError`/`ResolveError`, `import.meta.dir`/`path`/`file`/`resolveSync`, `import.meta.env`, and everything else in `deprecated.d.ts` that has a direct replacement. Keep `import.meta.dirname`/`filename` as the primaries.
blast radius: low-medium - they are already marked deprecated in types; removal is mechanical.
confidence: high.

### `console` is not Node's console: different formatter, non-standard `write()` and stdin iteration

what: Bun's global `console.log` uses Bun's own formatter (double-quoted strings, multi-line expansion with trailing commas, `"k": "v"` Maps) rather than `util.inspect`, while Bun's `util.inspect` *does* match Node exactly - so Bun maintains two formatters that disagree. Bun also adds `console.write()` and makes `console` an async iterator over `process.stdin`.
where: `docs/runtime/console.mdx:33` (*"In Bun, the `console` object is also an `AsyncIterable` that reads `process.stdin` line by line"*); `packages/bun-types/globals.d.ts:1151` (`[Symbol.asyncIterator]`).
evidence:
- Reproduced: `console.log({a:"x", m:new Map([["k","v"]])})` in Bun prints multi-line with `"x"` and `"k": "v",`; in Node prints one line with `'x'` and `'k' => 'v'`. `util.inspect(...)` of the same value is byte-identical across both runtimes.
- Reproduced: `typeof console.write` and `typeof console[Symbol.asyncIterator]` are `"function"` in Bun, `"undefined"` in Node.
- Open fallout issues on the `console` label: **#22790** (custom properties on empty arrays, "inconsistent with Node.js"), **#12365** ("shows inherited prototype properties"), **#12361** ("does not respect property enumerability"), **#19952** ("`console.trace()` goes to stdout instead of stderr"), **#16524**, **#13946**.
why bad: In Node, `console.log` is literally `util.inspect`, so snapshot tests, log parsers, and docs that copy-paste output are portable. Bun broke that link while *also* shipping a correct `util.inspect`, so it pays twice. Making the `console` namespace object an async iterator over stdin conflates an output API with input, and `console.write` duplicates `process.stdout.write`.
bun 2.0 proposal: Route `console.log`'s object formatting through the same code as `util.inspect` (keep the pretty formatter behind `Bun.inspect`). Remove `console[Symbol.asyncIterator]` (use `for await (const line of console /* stdin */)` → `readline` or `Bun.stdin`) and `console.write`.
blast radius: medium - log output changes visibly; nothing programmatic breaks except snapshots.
confidence: medium - the divergent formatter is deliberate and the team may consider it a feature, but the bug list above is the formatter's tax.

### `fetch()` silently honors `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` environment variables

what: Bun's global `fetch` (and `S3Client`) routes requests through proxies named by ambient env vars. Node's `fetch`/undici never do.
where: `/workspace/bun/src/runtime/webcore/fetch/FetchTasklet.rs:1891-1901`; `/workspace/bun/src/dotenv/env_loader.rs:314-368` (`get_http_proxy_for`); documented at `docs/guides/http/proxy.mdx`.
evidence: Reproduced - with `HTTP_PROXY=http://127.0.0.1:1` set, `fetch("http://example.invalid.test/")` in Bun fails with `ConnectionRefused` (it tried the proxy) rather than a DNS error. Issues: **#32045** (S3Client ignores `NO_PROXY`), **#6339** (`NO_PROXY` with spaces). The original feature request was **#1440**.
why bad: Network routing silently changes based on env vars that CI boxes, corporate laptops, and container images set for unrelated tools. This is the "httpoxy" class of surprise, and it's invisible from the call site. Code that is correct on Node routes through a proxy on Bun.
bun 2.0 proposal: Keep the explicit `fetch(url, { proxy })` extension; make env-var proxy sniffing opt-in (`BUN_CONFIG_HTTP_PROXY=…` or a bunfig key) rather than ambient.
blast radius: low-medium - most users never set these vars; the ones who do usually want it.
confidence: medium - deliberate, useful, but genuinely surprising; less evidence of team regret than the items above.

### Minor / supporting observations

- **`bun -e` injects `ffi`, `jsc`, `sqlite` as writable enumerable globals** (the whole `bun:ffi`/`bun:jsc`/`bun:sqlite` module namespaces). Reproduced: true under `bun -e`, false from a file. Undocumented, Bun-only, and a naming hazard (`const sqlite = …` in `-e`). Proposal: remove. Confidence: high (it exists) / low (impact). Blast radius: low.
- **`process.version` / `process.versions.node` / `process.release.name` claim to be a specific Node LTS.** `/workspace/bun/scripts/build/flags.ts:746` (`REPORTED_NODEJS_VERSION`), used by `/workspace/bun/src/jsc/bindings/BunProcess.cpp:215,2958`. The build comment at `/workspace/bun/src/runtime/cli/run_command.rs:698-700` says *"we have no way of knowing what version they're expecting … so we will just hardcode it to LTS."* Deno does the same; probably keep, but in 2.0 it should at minimum track the actual compat target advertised in `nodejs-compat.mdx`. Confidence: high it diverges; low it's a regret.
- **`.js` gets the JSX loader while `.mjs`/`.cjs` do not** - `/workspace/bun/src/bundler/options.rs:689,699-700` (`.js → Jsx`, `.mjs/.cjs → Js`). JSX in a plain `.js` file works in Bun and is a syntax error in Node. Inconsistent within Bun and a portability trap; proposal: gate JSX-in-`.js` behind `jsconfig`/`tsconfig` `jsx` or the `.jsx` extension. Confidence: high it diverges; medium it's worth changing.
- **`--require` and `--import` are both just aliases of `--preload`** (`/workspace/bun/src/runtime/cli/Arguments.rs:201-202`, `docs/snippets/cli/run.mdx:137,141`: *"Alias of --preload, for Node.js compatibility"*). In Node they have different semantics (CJS-sync vs ESM-async, loader-hook registration). Low confidence this matters, but the flag names promise Node behavior they don't deliver.

# Bun 2.0 candidates - Bun.build / bundler JS API / plugins / macros

All code references are to the `/workspace/bun` checkout; empirical claims verified against `bun 1.4.0` (`linux-x64`).

### `Bun.build` returns `{success:false}` - the regretted default, and its leftover scar tissue (`throw`, `success`)

what: Pre-1.2, a failed `Bun.build()` *resolved* with `{success:false}` instead of rejecting; the team called this a footgun, flipped it in 1.2, and the compat shims (`throw?: boolean` and the now-vestigial `BuildOutput.success`) are still in the API.
where: `packages/bun-types/bun.d.ts:2843-2849` (`throw?: boolean`, `@default true`), `bun.d.ts:3629` (`success: boolean`), `src/runtime/api/JSBundler.rs:1124` (`get_boolean_strict(... "throw")`), `src/runtime/api/js_bundle_completion_task.rs:229-277`.
evidence: Issue #12181 ("Breaking changes for Bun 1.2"), maintainer paperclover: *"make `Bun.build` a rejected promise on failure. people continue to run into this footgun that a failing build returns an object with `success: false`, especially when examples do not check the success code."* PR #15861 is titled *"add `throw: true` in Bun.build, to be made default in 1.2"*. paperclover on #16587: *"This change was made after seeing most users forget to handle `success: false`, or worse forget to await the promise at all."* Empirically: with the default config a resolved `BuildOutput` always has `success: true` (`js_bundle_completion_task.rs:691` is the only `success: TRUE` site; `:236` (`success: FALSE`) is followed by a rejection when `throw_on_error`).
why bad: `success` is dead weight on the default path (it is only meaningfully `false` inside `onEnd` callbacks or when the user opts into `throw:false`), and `throw:false` exists solely to preserve the regretted behaviour. Every `if (!result.success)` in the wild is now dead code, and new users copying old tutorials re-learn the confusion in reverse.
bun 2.0 proposal: Remove `throw` (always reject) and remove `BuildOutput.success`; `onEnd` gets the failure info via `result.errors`/`result.logs` like esbuild.
blast radius: medium - anyone using `throw:false` or branching on `success` needs a one-line change; the error path is already the default.
confidence: high.

### One `BunPlugin`/`PluginBuilder` type, two incompatible runtimes

what: `BunPlugin.setup(build: PluginBuilder)` is the *same* TypeScript type for runtime plugins (`Bun.plugin()`) and bundler plugins (`Bun.build({plugins})`), but the two builder objects expose disjoint method sets and pass differently-shaped args, so a plugin that typechecks for one crashes or silently misbehaves in the other.
where: `packages/bun-types/bun.d.ts:5523-5631` (`PluginBuilder`), `bun.d.ts:5638-5678` (`BunPlugin`), `src/js/builtins/BundlerPlugin.ts:346-374` (bundler surface), `src/js/builtins/BundlerPlugin.ts:356` / `:359` (`module()` / `addPreload()` throw inside `Bun.build`).
evidence: Verified on 1.4.0:
- Runtime `Bun.plugin()` builder is `{target, onLoad, onResolve, module}`; `onStart`, `onEnd`, `onBeforeParse`, `config`, `resolve`, `onDispose`, `initialOptions` are all `undefined` (so `build.onStart(...)` throws `"b.onStart is not a function"`), even though the type declares all of them and `config` is non-optional.
- Bundler builder: `build.module(...)` throws `"module() is not supported in Bun.build() yet. Only via Bun.plugin() at runtime"` (`BundlerPlugin.ts:356`), yet `module()` is declared unconditionally on `PluginBuilder` (`bun.d.ts:5630`).
- Runtime `onLoad` args are `["path"]` only; the type (`bun.d.ts:5429-5455`) declares `path`, `namespace`, `loader`, `defer` all non-optional.
- Runtime `onResolve` args are `["path","importer"]`; the type (`bun.d.ts:5467-5490`) declares `namespace`, `resolveDir`, `kind` too.
- Issue #9863 (open): "Bun runtime plugin `onResolve` doesn't filter non-`file:` protocol imports" - the same filter matches in the bundler and not in the runtime.
- `docs/runtime/plugins.mdx:6` claims: *"Bun has a universal plugin API that extends both the _runtime_ and the _bundler_."*
- `bun.d.ts:5642` on `BunPlugin.name`: *"In a future version of Bun, this will be used in error messages."* - a forward-looking promise on the type itself.
why bad: The whole point of one `BunPlugin` type is "write once, use in both"; in practice it types-checks everywhere and works nowhere. Because the gaps are runtime `undefined` lookups and `throw`s instead of type errors, users find out only in production.
bun 2.0 proposal: Split into `Bun.RuntimePluginBuilder` (`onLoad`/`onResolve`/`module`) and `Bun.BundlerPluginBuilder` (esbuild-shaped). Make `BunPlugin.setup` generic or accept a union, and make every hook either work or be a compile error.
blast radius: medium - type-only for most; plugins that already work keep working; only the TS surface moves.
confidence: high.

### `Bun.build` silently swallows unknown / esbuild-named / mis-placed options

what: `Bun.build()` ignores any config key it doesn't recognise - including esbuild names it *almost* supports, typos, and `outfile` - with no error and no warning, so builds silently lose options.
where: `src/runtime/api/JSBundler.rs:443+` (`Config::from_js` - each key is a `get_*` probe; there is no "did I read everything" check), `JSBundler.rs:410` (`outfile` is only read from the *`compile` sub-object*), `docs/bundler/esbuild.mdx:156` (`outfile` → `outfile` "No differences"), `packages/bun-types/bun.d.ts:3012-3028` (the `.d.ts`'s own `compile` example uses a *top-level* `outfile`).
evidence: Verified on 1.4.0:
- `Bun.build({entrypoints:["./a.js"], minfy:true, spliting:true, banana:"yes", entryNames:"[dir]/x"})` succeeds with no feedback. esbuild errors on the first one: `✘ [ERROR] Invalid option in build() call: "minfy"`.
- `Bun.build({entrypoints:["./a.js"], outfile:"./x.js"})` writes nothing, errors nothing.
- The `.d.ts`'s own JSDoc example `Bun.build({entrypoints:['./app.js'], compile:true, outfile:'./my-app'})` (bun.d.ts:3014-3021) produces an executable named `./a`, not `./my-app` - the top-level `outfile` is silently dropped because only `compile.outfile` is parsed.
why bad: A bundler config is exactly the place where a typo (`minfy`) or a half-remembered esbuild name (`entryNames`) must fail loudly; silently shipping an unminified / unsplit / wrongly-named bundle is strictly worse than an error. Bun's own type docs and migration guide (`outfile` "No differences") contradict the implementation, and there is no mechanism that would ever catch it.
bun 2.0 proposal: Reject unknown top-level keys like esbuild does (and list near-miss esbuild names in the message). At minimum, make `outfile` a real top-level `BuildConfig` key.
blast radius: medium - any config that currently carries a dead key starts erroring, but that is the point; the fix is deleting a typo.
confidence: high.

### The loader name set has ≥5 contradictory sources of truth; `dataurl`/`base64` are accepted and silently produce `""`

what: The set of valid loader names differs between the public `Loader` TS union, the map `Bun.build({loader})` actually accepts, the error message it prints, the `docs/bundler/esbuild.mdx` claims, and the list `onLoad` results are validated against - with concrete contradictions, including two loaders that are accepted everywhere and implemented nowhere.
where: `packages/bun-types/bun.d.ts:5349-5363` (`Loader` union: includes `napi`, excludes `dataurl`/`base64`), `src/options_types/bundle_enums.rs:174-201` (`LOADER_API_NAMES`: includes `node`/`dataurl`/`base64`/`json5`/`sqlite`/`md`, **excludes `napi`**), `src/runtime/api/JSBundler.rs:1113` (error string lists `"napi"`, `"base64"`, `"dataurl"`), `src/api/schema.d.ts:37-74` (`LoaderKeys`, the set `onLoad` return values are checked against), `docs/bundler/esbuild.mdx:44` and `:139` ("The esbuild loaders `dataurl`, `binary`, `base64`, `copy`, and `empty` are not implemented").
evidence: Verified on 1.4.0:
- `Bun.build({loader:{".node":"napi"}})` → `TypeError: loader must be one of "js", "jsx", "ts", "tsx", "css", "file", "json", "toml", "wasm", "napi", "base64", "dataurl", "text", "html"` - it rejects `"napi"` *and names `"napi"` as valid in the same message*. `"napi"` is the only spelling the TS `Loader` type allows (`"node"` is not in it).
- `Bun.build({loader:{".svg":"dataurl"}})` and `{".svg":"base64"}` are accepted by both the JS API and `bun build --loader .svg:base64`, and both emit `var ic_default = "";` - an **empty string**, silent data loss. Issue #20917 (open, `bug`+`bundler`): "plugin `onLoad` with dataurl `loader` bundles empty content `""` broken and incompatible with esbuild".
- At runtime `import "./ic.svg" with { type: "base64" }` returns the file *path* (the attribute is silently ignored).
why bad: Three user-visible surfaces (TS type, error message, accepted map) give three different answers to "what can I put here," and two of the accepted names silently destroy the data they were supposed to encode. Every one of the five lists must be maintained by hand.
bun 2.0 proposal: Derive the `Loader` TS union, the error message, and `LOADER_API_NAMES` from a single generated table. Either implement `dataurl`/`base64` (esbuild semantics) or reject them. Accept `"napi"` (the only name the type exports).
blast radius: low - `"node"` → `"napi"` is an alias addition; rejecting `dataurl`/`base64` only breaks users already getting `""`.
confidence: high.

### `loader: "object"` means two different things: live module in `Bun.plugin()`, `JSON.stringify` in `Bun.build()`

what: An `onLoad` callback returning `{exports, loader:"object"}` gives you a real module namespace (functions, classes, anything) under the runtime `Bun.plugin()`, but under `Bun.build()` the same return value is `JSON.stringify`'d and fed to the JSON loader - silently dropping functions, `undefined`, `Symbol`s, `Date`s, `Map`s.
where: `src/js/builtins/BundlerPlugin.ts:544-553` (`contents = JSON.stringify(result.exports); loader = "json";`), `packages/bun-types/bun.d.ts:5407-5427` (`OnLoadResultObject` - `loader: "object"`, which is not even a member of the `Loader` union).
evidence: Verified on 1.4.0: a bundler plugin returning `{exports:{foo:()=>1, bar:"baz"}, loader:"object"}` emits `var bar = "baz"; var virt_default = { bar };` - `foo` is gone with no error (because `JSON.stringify` drops functions rather than throwing, the `try/catch` at `BundlerPlugin.ts:551` never fires). Issue #19393 (open): "Default exports with loader: 'object'" - the behaviour is undocumented and can't express `default` exports. Issue #7128 (open): can't create an `export let`-like binding.
why bad: The single most natural reason to write one plugin is to use it in both contexts; `loader:"object"` is the only loader whose *semantics* (not just availability) change between them, and the failure mode is silent field loss.
bun 2.0 proposal: In `Bun.build`, either make `loader:"object"` a hard error ("use `loader:'js'` with generated source") or implement it properly by synthesising an ESM module from the object. Remove `"object"` from the set of loaders the bundler claims to accept.
blast radius: low - only affects bundler plugins already relying on the JSON-stringify coincidence.
confidence: high.

### `assert { type: "macro" }` still parses, and macros have four more entry points with three spellings

what: Bun's parser accepts the *abandoned* TC39 import-assertion syntax (`assert {type:"macro"}`) identically to `with {type:"macro"}`, and macros can also be enabled/remapped via `Bun.Transpiler({macro: MacroMap})` (singular), `Bun.build({macros: boolean})` (plural, untyped, undocumented), `bunfig.toml [macros]`, and `--no-macros`.
where: `src/js_parser/parse/mod.rs:1335-1341`, `src/ast/e.rs:2553` (`Object::get(obj, b"with").or_else(|| Object::get(obj, b"assert"))`), `packages/bun-types/bun.d.ts:2296`/`2429` (`MacroMap`, `TranspilerOptions.macro`), `src/runtime/api/JSBundler.rs:578` (`get_boolean_loose(global_this, "macros")` - **not in the `BuildConfig` type at all**), `src/runtime/cli/run_command.rs:812-827` (`bunfig [macros]` remap table).
evidence: Code comment at `src/js_parser/parse/mod.rs:1336-1340`: *"Import Assertions are deprecated. Import Attributes are the new way to do this. But some code may still use `assert`. We support both and treat them identically. Once Prettier & TypeScript support import attributes, we will add runtime support"* (both have for years). `docs/bundler/macros.mdx:52` calls `assert {type:'macro'}` *"an earlier incarnation of import attributes that has now been abandoned."* Verified on 1.4.0: `import {m} from "./mac.ts" assert {type:"macro"}` still runs. Node 22 deprecated and Node 23 removed the `assert` keyword; V8 removed it.
why bad: Bun is the only major runtime still parsing `assert`, and the parser carries it only for a macro feature whose entry points are already scattered across four config spellings (`macro` / `macros` / `[macros]` / `--no-macros`), two of which are invisible to TypeScript.
bun 2.0 proposal: Drop `assert` (match Node 23/V8). Pick one name (`macros`) and one shape; delete the 0.x `MacroMap` remap mechanism (`Bun.Transpiler({macro})` + `bunfig [macros]`) or at least make `Bun.build({macros})` typed and documented.
blast radius: low - `assert` is a one-word sed to `with`; the `MacroMap` remap mechanism appears unused outside 2021-era `bun-macro-relay`.
confidence: high.

### `sourcemap: true` means `"linked"` *or* `"inline"` depending on `outdir`; the `.d.ts` says it's always `"inline"`

what: The meaning of `sourcemap: true` depends on whether an unrelated option (`outdir`) is present - a leftover from the 1.2 half-migration of the `--sourcemap` default - and the type documentation still describes the pre-1.2 contract.
where: `src/runtime/api/JSBundler.rs:650-658` (`if source_map_js == TRUE { this.source_map = if has_out_dir { Linked } else { Inline } }`), `packages/bun-types/bun.d.ts:2687`: *"`true` and `false` are aliases for `\"inline\"` and `\"none\"`, respectively."*
evidence: Verified on 1.4.0: `{sourcemap:true, outdir:"./out"}` → emits `a.js` + `a.js.map` (linked); `{sourcemap:true}` with no `outdir` → `//# sourceMappingURL=data:...` (inline). paperclover on #12181: *"bundler: `--sourcemap` without an argument is going to default to `linked` instead of `inline`"* - the CLI flip happened, the JS API got a conditional, the `.d.ts` got neither.
why bad: A boolean whose meaning depends on a second option is unlearnable, and the one place users look it up (`.d.ts` hover) is wrong.
bun 2.0 proposal: `sourcemap: true` always means `"linked"` (erroring if there's no `outdir`), matching the 1.2 CLI default; fix the `.d.ts`. Deprecate the boolean overload in favour of the string enum.
blast radius: low - only affects `sourcemap:true` without `outdir`, and the change is inline→linked-error.
confidence: high.

### Bun's `onResolve`/`onLoad` silently diverge from esbuild's args/results (`pluginData`, `resolveDir`, `with`), breaking real esbuild plugins

what: Bun advertises esbuild plugin compatibility, but `onResolve`/`onLoad` omit `pluginData` (args *and* results), `resolveDir` (onLoad results), `watchFiles`/`watchDirs`, `errors`/`warnings`, and import attributes - and the stubs for `build.resolve()`/`onDispose` throw.
where: `src/js/builtins/BundlerPlugin.ts:420` (`// pluginData` commented out), `:524-525` (`// suffix`, `// pluginData`), `:348`/`:354` (`onDispose`/`resolve` → `notImplementedIssueFn(2771, …)`), `packages/bun-types/bun.d.ts:5488-5489` (`// resolveDir: string; // pluginData: any;`), `docs/bundler/esbuild.mdx:235-301` (the 🔴 tables), `docs/bundler/esbuild.mdx:178`: *"many third-party esbuild plugins work with Bun without modification."*
evidence: Issues (all open): #8994 "Missing Esbuild plugin API options (resolveDir, pluginData)" - `esbuild-rails` crashes with `undefined is not an object (evaluating 'args.pluginData')`; #20922 "plugin `onLoad` does not get `pluginData` in args, returned by the `onResolve`"; #2771 (open since 2023) "Support esbuild plugin `onStart`, `onEnd`, and `onDispose` callbacks" is literally hard-coded into the error users see; #7293 / #16147 (import attributes in plugins); #6173 (sourcemaps from `onLoad`). Issue #27066 (still open, `docs`) is titled "Plugin API documentation out of date and inconsistent" - the esbuild-compat tables have already drifted from the implementation at least once.
why bad: `pluginData` is the *plumbing* of the esbuild plugin model (it's how `onResolve` talks to `onLoad`); without it, "esbuild plugins work without modification" is false for any non-trivial plugin, and the failure is a runtime `undefined` deep inside someone else's package.
bun 2.0 proposal: Ship `pluginData` end-to-end and `resolveDir` in `OnLoadResult`, and implement `build.resolve()`; until then, remove the "work without modification" claim.
blast radius: low - pure additions.
confidence: high.

### `BuildArtifact extends Blob` is a lie at runtime

what: The type says `interface BuildArtifact extends Blob`, but the runtime object's prototype chain is `Object -> Object` and `artifact instanceof Blob` is `false`.
where: `packages/bun-types/bun.d.ts:3614` (`interface BuildArtifact extends Blob`), issue repro.
evidence: Issue #16374 (open, `bug`): "`BuildArtifact` is said to extend `Blob`, but `Blob` isn't in it's prototype chain". Verified on 1.4.0: `instanceof Blob: false | proto chain: Object -> Object`. The issue also notes there is no exported `BuildArtifact` constructor, so there is *no* way to type-check an artifact at runtime.
why bad: Any code that branches on `instanceof Blob` (a common idiom when accepting `Bun.write`-able inputs) silently takes the wrong path; structural duck-typing only saves you until someone checks the brand.
bun 2.0 proposal: Make `BuildArtifact.prototype` actually inherit from `Blob.prototype` (it already has `text/arrayBuffer/stream/slice/type/size`), and export the constructor from `"bun"`.
blast radius: low - strictly more compatible.
confidence: high.

### `entryPoints` is a secret esbuild alias in `Bun.build()`

what: `Bun.build({entryPoints: [...]})` (esbuild capitalization) works as an undocumented fallback for `entrypoints`, but no other esbuild spelling (`entryNames`, `chunkNames`, `platform`, `minifyWhitespace`, …) does - they are silently dropped (see the unknown-option finding).
where: `src/runtime/api/JSBundler.rs:806-809` (`config.get_array(global_this, "entrypoints")? … None => config.get_array(global_this, "entryPoints")?`), `src/js/builtins/BundlerPlugin.ts:33-34` (`// we support esbuild-style 'entryPoints' capitalization`). Not in `BuildConfig` (`packages/bun-types/bun.d.ts:2605-3039`), not in any doc.
evidence: Verified on 1.4.0: `Bun.build({entryPoints:["./a.js"]})` produces 1 output. The only trace of the feature is a TypeScript comment inside the private builtin.
why bad: A *half* compat layer is worse than none: `entryPoints` + `entryNames` copied from an esbuild config gives you a build where one option worked and the other silently vanished. Two spellings for the same required field also means TS can't catch `entrypoints:` missing when `entryPoints:` is present.
bun 2.0 proposal: Remove the `entryPoints` alias (or, if keeping an esbuild compat layer, make it complete and documented and pair it with strict unknown-key rejection).
blast radius: low - one rename for anyone depending on the hidden alias.
confidence: high.

### `bytecode: true` silently mutates the `format` default from `"esm"` to `"cjs"` (and forces `target: "bun"`)

what: Setting `bytecode: true` with no explicit `format` silently changes the output module format from the documented default `"esm"` to `"cjs"`, and overrides `target` to `"bun"` if it wasn't explicitly set.
where: `src/runtime/api/JSBundler.rs:582-594`. The code comment at `:586` is an admission: *"Default to CJS for bytecode, since esm doesn't really work yet."* The `.d.ts` declares `format … @default "esm"` (`bun.d.ts:2629`).
evidence: Verified on 1.4.0: `Bun.build({entrypoints:["./a.js"], bytecode:true, target:"bun"})` emits `// @bun @bytecode @bun-cjs` and a CJS wrapper. `bun.d.ts:2778-2786` now documents the behaviour ("Without an explicit `format`, defaults to CommonJS."), but the `format` field's own `@default "esm"` is not qualified.
why bad: An option (`bytecode`) changing the default of an *orthogonal* option (`format`) is exactly the kind of action-at-a-distance users can't reason about; if they later add `format:"esm"` they hit `"ESM bytecode requires compile: true"` (`JSBundler.rs:1264`). The comment itself says this is a workaround ("esm doesn't really work yet").
bun 2.0 proposal: Once ESM bytecode works without `compile`, make `bytecode` honour the `format` default like every other option; until then, *error* on `bytecode:true` with no explicit `format` rather than silently switching it.
blast radius: low - only affects `bytecode` users relying on the implicit CJS.
confidence: high.

### `OnBeforeParseCallback` is not a callback (and `onBeforeParse` doesn't take one)

what: The type `Bun.OnBeforeParseCallback` is an object descriptor `{napiModule, symbol, external}`, not a function, and `PluginBuilder.onBeforeParse(constraints, callback: OnBeforeParseCallback)` names a non-function parameter `callback` - an API shape completely unlike its siblings `onLoad`/`onResolve`/`onStart`/`onEnd`, all of which take real callbacks.
where: `packages/bun-types/bun.d.ts:5461-5465` (`type OnBeforeParseCallback = { napiModule: unknown; symbol: string; external?: unknown | undefined; }`), `bun.d.ts:5561` (`onBeforeParse(constraints, callback: OnBeforeParseCallback)`), `docs/bundler/plugins.mdx:401-403` (also spells it `callback:`), `src/js/builtins/BundlerPlugin.ts:238-245`.
evidence: The type is literal in the `.d.ts`: a `type …Callback =` that is an object literal with no call signature, `napiModule: unknown`. The runtime validator at `BundlerPlugin.ts:181-186` admits `// TODO: how to check if it a napi module here?`. (Bonus: the sibling validation error at `BundlerPlugin.ts:193` is the verbatim user-facing string `TypeError: lmao callback must be a function`, shipped since PR #14971 - verified on 1.4.0.)
why bad: `onBeforeParse` is the only builder hook whose second argument is an object, it's named to look like a callback, it's typed `unknown`, and the hook is native-only - three axes of surprise on one method. Meanwhile the "lmao" error string is what every user who passes a non-function to `onLoad`/`onResolve` actually sees.
bun 2.0 proposal: Rename the type to `OnBeforeParseAddon` (or move `onBeforeParse` off `PluginBuilder` into a `nativePlugins` config key since it has nothing in common with the JS hooks), type `napiModule` nominally, and fix the error string.
blast radius: low - type rename + error message.
confidence: high.

### In-memory `BuildArtifact.path` collides with the source file's path

what: When `outdir` is omitted (in-memory build), `BuildArtifact.path` is the naming-template result relative to the inferred `root` - which for a single entrypoint is *exactly the source file's own relative path* - so the natural write-back pattern destroys the source.
where: `src/runtime/api/JSBundler.rs:859-900` (root inference: `dirname(entry_points[0])` for a single entrypoint), `docs/bundler/index.mdx:314` (in-memory artifacts), `docs/bundler/index.mdx:329` (the safe-ish recipe `Bun.write(path.join("out", res.path), res)`).
evidence: Verified on 1.4.0: `(await Bun.build({entrypoints:["./a.js"]})).outputs[0].path === "./a.js"`; `await Bun.write(o.path, o)` overwrites `./a.js` with the bundled output. Issue #4407 describes the same class for dynamic imports: *"`import(\"abc\")` results in overwriting `node_modules/abc/index.js`"*. Issue #15033 (open, `enhancement`, commented on by paperclover) is a related complaint: with hashed naming there is no way to map an output back to its entrypoint.
why bad: A field named `path` on a `Blob`-like object irresistibly suggests `Bun.write(x.path, x)`; making it coincide with the input path on the most common config (one entrypoint, no `outdir`) is a source-code-destroying footgun. esbuild's `write:false` artifacts carry the *output* path prefixed by `outdir`.
bun 2.0 proposal: When nothing was written, make `path` an output-relative name that cannot collide with inputs (e.g. require `outdir` to materialise `path`, or rename to `name`), and add `sourceFile`/`entryPointIndex` (already tracked natively per paperclover on #15033).
blast radius: medium - `path` is widely read; changing its shape needs a deprecation cycle.
confidence: medium.

### `--platform` was renamed to `--target`, permanently squatting the name Bun will need for syntax downleveling

what: Bun renamed esbuild's `--platform` to `--target`, documented as being *"for consistency with tsconfig"* - but `tsconfig.compilerOptions.target` means the ES syntax level (`"es2017"`), i.e. esbuild's `--target`, not its `--platform`. Bun now has no name left for syntax downleveling, which it explicitly does not do yet.
where: `docs/bundler/esbuild.mdx:49`: *"`--platform` | `--target` | Renamed to `--target` for consistency with tsconfig. Does not support `neutral`."* Four lines later, `docs/bundler/esbuild.mdx:53`: *"`--target` | n/a | Not supported. Bun's bundler performs no syntactic down-leveling."* `packages/bun-types/bun.d.ts:5329-5346` (`Target = "bun"|"node"|"browser"`; the JSDoc for `"node"` reads *"The plugin is applied to Node.js builds"* - copy-pasted from the plugin context).
evidence: Both quotes above are verbatim from the same table. The stated justification is self-refuting: the thing tsconfig calls `target` is the thing Bun says is "Not supported."
why bad: When Bun adds syntax lowering (a frequently requested bundler feature), `target` - the name every other tool and tsconfig uses for it - will already mean "platform." That's a permanent, user-visible naming tax caused by a rename that was justified by an incorrect premise.
bun 2.0 proposal: Either keep `target` as platform and never call downleveling `target` (add `supported`/`browsers`), or rename to `platform`/`runtime` while downleveling is still unimplemented - the cost will never be lower than now.
blast radius: high - `target` appears in nearly every `Bun.build` config in existence; needs a long alias period.
confidence: medium (the regret is structural, not yet stated by the team).

### The documented `AggregateError` inspection pattern prints `{}`

what: `docs/bundler/index.mdx` recommends `console.error(JSON.stringify(error, null, 2))` to serialize a `Bun.build` failure, and that produces `{}` because `AggregateError.errors`/`.message` are non-enumerable.
where: `docs/bundler/index.mdx:1598`.
evidence: Issue #16587 (closed/completed, but the behaviour is unchanged). Verified on 1.4.0: `JSON.stringify(e)` → `{}` while `e.errors.length === 1`. paperclover on #16587: *"I did not check that JSON.stringify actually works"*.
why bad: The only place the error-handling contract is documented gives a recipe that prints nothing; this compounds the #1 finding (the `throw` change was made *because* people weren't reading errors).
bun 2.0 proposal: Give the build `AggregateError` an own-enumerable `toJSON()` (returning `{message, errors:[…]}`), or change the doc to `console.error(e)` / `e.errors`.
blast radius: low - additive.
confidence: high.

---

## Supporting observation (not a standalone finding)

The `docs/bundler/esbuild.mdx` compatibility tables are badly stale in *both* directions and there is no test keeping them honest: `metafile`, `conditions`, `drop`, `banner`, `footer`, `minify.keepNames`, `tsconfig`, `treeShaking` are all listed as "Not supported" in the JS-API table (`esbuild.mdx:115,120,122,126,137,147,172-173`) yet every one is in `BuildConfig`; `format` is listed as *"Only supports `\"esm\"`"* (`esbuild.mdx:127`) while the type and implementation support `esm`/`cjs`/`iife`; `--global-name` says *"Bun does not support `iife` output"* (`esbuild.mdx:67`) three rows after `--format` says it's planned. Issue #27066 (open, `docs`) is the users noticing. This drift is how several of the findings above stayed invisible: the compat contract for the bundler JS API has no source of truth.

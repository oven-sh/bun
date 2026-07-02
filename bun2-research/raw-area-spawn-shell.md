# Bun 2.0 candidates - `Bun.spawn` / `Bun.spawnSync` / `Bun.$`

All findings verified against the checkout at `/workspace/bun` and empirically against
`USE_SYSTEM_BUN=1 bun 1.4.0` unless noted. Ordered strongest-first.

### `Subprocess.killed` means "has exited", not "was killed"

what: `proc.killed` is `true` after *any* exit - including a normal `exit(0)` that nobody ever signalled.
where: `/workspace/bun/src/spawn/process.rs:164-166` (`has_killed()` = `matches!(status, Exited(_) | Signaled(_))`), getter at `/workspace/bun/src/runtime/api/bun/subprocess.rs:827-830`; `/workspace/bun/packages/bun-types/bun.d.ts:7271-7274`; `/workspace/bun/docs/runtime/child-process.mdx:134`.
evidence: Empirically: `const p = Bun.spawn(["true"]); await p.exited; p.killed === true, p.exitCode === 0, p.signalCode === null`. The `.d.ts` *admits* the mismatch: the property named `killed` is documented as `/** Whether the process has exited */` (bun.d.ts:7272). The user docs contradict both: `proc.killed; // boolean - was the process killed?` (child-process.mdx:134). Node's `ChildProcess.killed` means "subprocess.kill() was used to successfully send a signal".
why bad: The name, the docs, the JSDoc, and Node all disagree with the implementation. `if (proc.killed) handleCrash()` silently misfires on every clean exit; the one thing the property's name promises is the one thing it can't tell you.
bun 2.0 proposal: Make `killed` mean "`.kill()` was called" (track a boolean set in `try_kill`), matching Node and the docs. Expose the current semantics as the already-existing `exitCode !== null` / a new `exited`-style boolean if anyone needs it.
blast radius: medium - anyone relying on `killed === "has exited"` breaks, but they almost certainly *meant* the new semantics.
confidence: high.

### IPC `serialization` defaults to a Bun-only wire format, silently breaking Node.js children

what: `Bun.spawn({ipc})` defaults to `serialization: "advanced"`, which the source documents as "Only valid for bun <--> bun communication" - so the out-of-the-box IPC handshake with a `node` child delivers zero messages and raises zero errors.
where: default: `/workspace/bun/src/runtime/api/bun/js_bun_spawn_bindings.rs:519` (`break 'ipc_mode IPC::Mode::Advanced;`); mode doc: `/workspace/bun/src/jsc/ipc.rs:205-211`; child env: js_bun_spawn_bindings.rs:992-993 sets `NODE_CHANNEL_SERIALIZATION_MODE=advanced`; docs `/workspace/bun/docs/runtime/child-process.mdx:279-290`.
evidence: Source comment, `src/jsc/ipc.rs:206`: `/// Uses SerializedScriptValue to send data. Only valid for bun <--> bun communication.` Empirically: `Bun.spawn(["node","child.cjs"],{ipc(m){got.push(m)}})` + `p.send({ping:1})` → parent receives `[]`, child's `message` handler never fires, no error on either side. Adding `serialization:"json"` makes the identical program work. Docs already warn: "To use IPC between a `bun` process and a Node.js process, set `serialization: "json"`" (child-process.mdx:288-290). Issue #8955 ("Implement IPC for non-Bun processes", closed) was resolved by adding the *opt-in* `"json"` mode instead of fixing the default; #16132 ("process.send is broken with pm2").
why bad: Node's own `child_process` defaults to `"json"`. Bun reuses Node's option name `"advanced"` and even exports `NODE_CHANNEL_SERIALIZATION_MODE=advanced` to the child - but Node's `"advanced"` is V8-serialize and Bun's is JSC `SerializedScriptValue`, so the same option string names two incompatible wire formats. The failure mode is total silence.
bun 2.0 proposal: Default to `"json"` (Node-compatible). Keep `"advanced"` opt-in for bun↔bun, and throw/warn if a non-bun child is detected with `"advanced"` (Bun's Advanced mode already sends a version packet, so it can detect the peer).
blast radius: medium - bun↔bun IPC loses structured-clone types by default; one-line opt-back-in.
confidence: high.

### The default `stderr` differs between `Bun.spawn` ("inherit") and `Bun.spawnSync` ("pipe")

what: `Bun.spawn`'s default stdio is `["ignore","pipe","inherit"]` but `Bun.spawnSync`'s is `["ignore","pipe","pipe"]`, so `proc.stderr` is `undefined` on async spawn and a `Buffer` on sync spawn with otherwise-identical calls.
where: `/workspace/bun/packages/bun-types/bun.d.ts:6786-6787` (`@default ["ignore","pipe","inherit"] for spawn / ["ignore","pipe","pipe"] for spawnSync`), 6824-6825, and the generic defaults at bun.d.ts:7364 (`Err = "inherit"`) vs 7436 (`Err = "pipe"`); `/workspace/bun/docs/runtime/child-process.mdx:110-111`.
evidence: Verbatim JSDoc: `@default "inherit" for \`spawn\` / "pipe" for \`spawnSync\`` (bun.d.ts:6824-6825). Empirically: `Bun.spawnSync(["node","-e","console.error('E')"]).stderr` is `Buffer("E\n")`; `Bun.spawn(...)` with the same cmd prints `E` to the parent's terminal and `.stderr` is `undefined`.
why bad: The two siblings are documented as "supports the same inputs and parameters" (child-process.mdx:430) yet silently diverge on the most error-relevant stream. Node's `spawn`/`spawnSync` both default stderr to `pipe`. Users routinely write `Bun.spawn(cmd); await proc.stderr.text()` and get `undefined is not an object`.
bun 2.0 proposal: Pick one default (`"pipe"` for both, matching `spawnSync` and Node) and document it once.
blast radius: medium - scripts that relied on free stderr passthrough from async `spawn` would have to add `stderr:"inherit"`; nothing breaks silently (you'd just stop seeing child stderr).
confidence: high.

### `await proc.exited` and `proc.exitCode` disagree on signal death

what: After the child dies from a signal, the `exited` promise (documented as "The exit code of the process") resolves to the synthesized shell value `128 + signal` (or a magic `254` if out of range), while `exitCode` is `null`.
where: `/workspace/bun/src/runtime/api/bun/subprocess.rs:1303-1334` (`get_exited` → `to_exit_code().unwrap_or(254)`; `get_exit_code` → `NULL` for `Signaled`); `/workspace/bun/src/spawn/process.rs:793-794` ("Shell-convention: 128 + signal number"); `/workspace/bun/packages/bun-types/bun.d.ts:7245-7257`.
evidence: Empirically: `const p = Bun.spawn(["sleep","10"]); p.kill("SIGKILL"); await p.exited` → `137`, while `p.exitCode === null` and `p.signalCode === "SIGKILL"`. The JSDoc on `exited` says "The exit code of the process" (bun.d.ts:7246) yet the value `137` is not the exit code under Bun's own `exitCode` definition. `.unwrap_or(254)` is an undocumented sentinel (subprocess.rs:1310).
why bad: Two properties on the same object both claim to be "the exit code" and return different things for the same exit. `if (await p.exited !== 0)` and `if (p.exitCode !== 0)` give different answers, and `254` is indistinguishable from a real `exit(254)`.
bun 2.0 proposal: Resolve `exited` to the same `number | null` as `exitCode` (or resolve it to a `{ exitCode, signalCode }` object); never synthesize `128+sig`/`254`.
blast radius: medium - code that specifically checks `await proc.exited > 128` breaks; most code only compares to `0`.
confidence: high.

### `ShellError.info` is an admitted backwards-compat duplicate, and the error is unusable in logs

what: `ShellError` carries both top-level `exitCode/stdout/stderr` *and* a redundant `info: {exitCode, stdout, stderr}` kept only because removing it would be breaking; the message is just `"Failed with exit code N"` with no command, no stderr text, and no signal.
where: `/workspace/bun/src/js/builtins/shell.ts:27-51` (esp. the comment at 32-33); `/workspace/bun/packages/bun-types/shell.d.ts:221-297` (which doesn't even declare `info`).
evidence: Verbatim source comment at shell.ts:32-33: `// We previously added this so that errors would display the "info" property` / `// We fixed that, but now it displays both.` Open issues: #17819 "ShellError should print to console nicer" ("covers the screen with numbers instead of characters / does not say what command failed / why 134 and not the signal") and #16533 "Shell ($) should print stdout & stderr more nicely and just not print out `Buffer` with bytes" (and #33235 on concatenated parse errors). Empirically `await $\`exit 3\`` throws with `message: "Failed with exit code 3"` and own keys `["message","info","exitCode","stdout","stderr","name","line","column","stack"]`.
why bad: Every field is duplicated, the types and runtime disagree (`info` is undeclared), and the part users actually see (`message` + the `Buffer` inspector dump) answers none of "which command", "what did stderr say", "was it a signal?". The source admits the duplication is a regret.
bun 2.0 proposal: Drop `info`; add `signalCode`, the command text, and a stderr excerpt to `message`; give `stdout`/`stderr` a string-friendly `[Symbol.for("nodejs.util.inspect.custom")]`. Add `signalCode` to the `.d.ts`.
blast radius: low - `error.info.*` is rare; the top-level fields stay.
confidence: high.

### `mkdir --vebose`: a literal typo is the accepted flag; the correct spelling is rejected

what: Bun Shell's built-in `mkdir` accepts the misspelled long flag `--vebose` and rejects the real GNU flag `--verbose` as "illegal option".
where: `/workspace/bun/src/runtime/shell/builtin/mkdir.rs:435-439`.
evidence: Verbatim source comment, mkdir.rs:435: `// Note: the \`--vebose\` typo is intentional (kept for compatibility).` (`git log -L` shows the pre-Rust-port version read `// Note: Zig has the same \`--vebose\` typo (mkdir.zig:497)` - the team noticed it and *preserved* it through the Rust rewrite, #30412). Empirically: `mkdir --vebose /tmp/x` → exit 0; `mkdir --verbose /tmp/y` → exit 1, `mkdir: illegal option -- verbose`. `-v` works.
why bad: A copy/paste typo from the original implementation is now load-bearing API surface that no real script on Earth targets, while the flag every `mkdir(1)` user types is rejected. "Kept for compatibility" is written in the source about a misspelling.
bun 2.0 proposal: Accept `--verbose`; either delete `--vebose` or keep it as a silent alias.
blast radius: low - nobody intentionally writes `--vebose`.
confidence: high.

### `ShellPromise` is a lazy Promise subclass: an un-awaited `$` command silently never runs

what: `Bun.$\`...\`` returns a `Promise` subclass that does nothing until `.then()` is invoked; if you never `await` / `.then()` / call an output method, the command never executes - no warning.
where: `/workspace/bun/src/js/builtins/shell.ts:106-250` (`#hasRun`, `#run()` called only from `then()` at :241-245 and the undocumented `run()` at :236-239); `/workspace/bun/packages/bun-types/shell.d.ts:79-91` ("A shell command that runs once awaited").
evidence: Empirically: `Bun.$\`touch /tmp/bun_lazy_marker\`; await Bun.sleep(300)` → the file does NOT exist. The original shell PR even contains the abandoned alternative as a comment: shell.ts:146 `// this.#immediate = setImmediate(autoStartShell, this).unref();` - eager auto-start was considered and commented out. `google/zx` starts eagerly (a `ProcessPromise` runs whether or not you await).
why bad: A `Promise` is supposed to represent an already-initiated operation; making the side effect depend on whether a consumer observes the value violates the one invariant everybody has about promises. A dropped `$` call (e.g. inside a forgotten `return`) is a silent no-op instead of an unhandled rejection. The escape hatch (`.run()`) is implemented but absent from `shell.d.ts`.
bun 2.0 proposal: Start the interpreter eagerly on a microtask (uncomment the `setImmediate` approach, or start in the constructor), so output methods can still call `.quiet()`/`.cwd()` synchronously before the first tick, and an unhandled failure surfaces as an unhandled rejection.
blast radius: medium - code that constructs-but-conditionally-awaits `$` objects would start running them; but `quiet()/cwd()/env()` already throw "Shell is already running" once started, so the deferred-config pattern survives a one-tick delay.
confidence: high.

### `ShellPromise` buffers everything and cannot stream; its `.d.ts` has drifted (phantom `stdin`, untyped `bytes()`/`run()`)

what: The shell always buffers the full stdout/stderr in memory (`.text()`/`.lines()`/`.arrayBuffer()` all `await quiet()` first), there is no streaming access, and the one streaming member in the types - `get stdin(): WritableStream` - has never existed at runtime; meanwhile `bytes()` and `run()` exist at runtime but are missing from the types.
where: `/workspace/bun/packages/bun-types/shell.d.ts:91` (`get stdin(): WritableStream;`); `/workspace/bun/src/js/builtins/shell.ts:106-250` (no `stdin`; `bytes()` at :223, `run()` at :236; `lines()` at :208 splits a fully-buffered string).
evidence: `git log -S "get stdin(): WritableStream"` → introduced by `1b1760a9c9 feat: Bun shell (#7748)`, the original PR, never implemented. Empirically `typeof Bun.$\`echo hi\`.stdin === "undefined"` and the prototype own-names are `[constructor, cwd, env, quiet, nothrow, throws, text, json, lines, arrayBuffer, bytes, blob, run, then]` - no `stdin`. Issue #14693 (open, 10 👍): "Reading stdout and stderr while a process created with Bun Shell is running" explicitly describes `lines()`/`text()` "essentially waiting for the process to finish before reading the buffered stdout". Also #33234: "Bun Shell: no way to give spawned commands a TTY (stdout/stderr are always pipes)".
why bad: `shell.d.ts` advertises an API (`stdin: WritableStream`) that does not exist, and the API people actually ask for (streaming stdout) doesn't either; `await $\`long-running\`.lines()` blocks until exit, contradicting the "line by line" docstring. The type file and the implementation have been out of sync since the feature shipped.
bun 2.0 proposal: Either implement `stdin`/`stdout`/`stderr` as real streams on `ShellPromise` or delete the phantom `stdin` getter; add the missing `bytes()`/`run()` declarations. Make `.lines()` actually incremental.
blast radius: low for the type fix (nobody can be using a getter that returns `undefined`); medium for making `lines()` incremental.
confidence: high.

### `$.nothrow()` / `$.throws()` / `$.env()` / `$.cwd()` mutate a process-global singleton

what: `import { $ } from "bun"` yields one shared object; `$.nothrow()` (and `$.throws/env/cwd`) mutate it in place and are typed as returning `$`, so any library calling `$.nothrow()` silently disables error-throwing for *every other module in the process*.
where: `/workspace/bun/src/js/builtins/shell.ts:260-315` (`BunShell[throwsSymbol]` read at :308, mutated by `ShellPrototype.nothrow` at :291-294); `/workspace/bun/packages/bun-types/shell.d.ts:60-77`; `/workspace/bun/docs/runtime/shell.mdx:108-123`.
evidence: Empirically (two modules): a `lib.ts` whose function runs `$.nothrow(); await $\`exit 7\`` causes `main.ts`'s subsequent `await $\`exit 1\`` to **not** throw - printed `"NO THROW in main -> global state leaked from lib"`. The docs teach it as a feature: "To change the default for all commands, call `.nothrow()`... on the `$` function itself" (shell.mdx:108). Related: `$.env({FOO:"bar"})` *replaces* the environment - `PATH` and `HOME` become empty - which is how `Bun.spawn({env})` works too, but the `@default process.env` JSDoc (shell.d.ts:50) invites `$.env({FOO:"x"})` without the spread. Issue #25885 ("Bun Shell `.env()` PATH changes don't affect command resolution") is downstream of the `env` replacement semantics.
why bad: Ambient mutable global config is the classic "library breaks application" footgun; the isolated alternative (`new Bun.$.Shell()`) exists but is the non-default, and the `: $` return type reads like a fluent copy, not an in-place mutation.
bun 2.0 proposal: Make `$.nothrow()`/`$.throws()`/`$.env()`/`$.cwd()` return a *new* `Shell` instance (what the `: $` type already implies) and leave the imported `$` immutable; keep per-call `.nothrow()` on `ShellPromise`.
blast radius: medium - scripts that set `$.throws(false)` once at the top would need `const sh = $.throws(false)`.
confidence: high.

### `Subprocess.readable`/`writable` aliases exist for a `pipeThrough` compatibility that doesn't work

what: `Subprocess.readable` duplicates `stdout` "for compatibility with `ReadableStream.pipeThrough`", and an *undocumented* `Subprocess.writable` duplicates `stdin` - but `pipeThrough(subprocess)` throws, because `writable` is a `FileSink`, not a WHATWG `WritableStream`.
where: `/workspace/bun/src/runtime/api/BunObject.classes.ts:71-78` (`writable: {getter:"getStdin", cache:"stdin"}`, `readable: {getter:"getStdout", cache:"stdout"}`); `/workspace/bun/packages/bun-types/bun.d.ts:7228-7233` (declares `readable` with the `pipeThrough` rationale; `writable` is not in the `.d.ts` at all).
evidence: Verbatim JSDoc, bun.d.ts:7230-7231: "The same value as {@link Subprocess.stdout} / Exists for compatibility with {@link ReadableStream.pipeThrough}". Empirically: `new Response("x").body.pipeThrough(proc)` → `TypeError: writable should be WritableStream`. `p.readable === p.stdout` is `true`.
why bad: Pure duplicate surface area whose single stated justification is provably false at runtime; one half of the pair is also a hidden, undocumented property.
bun 2.0 proposal: Either make `writable` a real `WritableStream` so `pipeThrough(proc)` works (a genuinely great API), or delete both aliases.
blast radius: low - `proc.readable` appears in almost no code (people write `proc.stdout`).
confidence: high.

### `Subprocess.stdio[0..2]` are permanently `null` (type and implementation both admit it)

what: `proc.stdio` is documented/typed as always having `null` in the three standard slots regardless of what you passed for `stdin/stdout/stderr`.
where: `/workspace/bun/src/runtime/api/bun/subprocess.rs:836-837` (two `// TODO: align this with options` lines); `/workspace/bun/packages/bun-types/bun.d.ts:7226` (`readonly stdio: [null, null, null, ...(number | null)[]]`).
evidence: The implementation: `array.push(global, JSValue::NULL)?; // TODO: align this with options` × 2 (subprocess.rs:836-837). The type literally encodes the bug: `[null, null, null, ...]`.
why bad: A property named `stdio` on a subprocess that cannot tell you about stdin/stdout/stderr is nonsense; the type being authored to match the TODO means the workaround was promoted to a contract.
bun 2.0 proposal: Populate indices 0-2 (mirroring `proc.stdin/stdout/stderr`), matching the shape of Node's `ChildProcess.stdio`.
blast radius: low - nobody can be depending on the literal `null`s.
confidence: high.

### Signal/exit types are declared three different ways, and two are wrong

what: `Subprocess.signalCode` is `NodeJS.Signals | null`, `SyncSubprocess.signalCode` is `?: string` (optional, not `| null`), and `onExit`'s `signalCode` param is typed `number | null` but is a **string** at runtime; plus `SyncSubprocess.exitCode` is typed non-nullable `number` but is `null` at runtime on signal death; plus `resourceUsage` is a method on `Subprocess` and a plain property on `SyncSubprocess`.
where: `/workspace/bun/packages/bun-types/bun.d.ts:7269` vs :7339 vs :6849-6852; :7332 (`exitCode: number`); :7316 (`resourceUsage(): ResourceUsage | undefined`) vs :7337 (`resourceUsage: ResourceUsage`). Also echoed in `/workspace/bun/docs/runtime/child-process.mdx:507` (`signalCode: number | null`).
evidence: Empirically: `Bun.spawn(["sleep","10"],{onExit(p,c,sig){...}}); p.kill("SIGKILL")` → `onExit` receives `sig === "SIGKILL"` (`typeof "string"`), not a number. `Bun.spawnSync(["sh","-c","kill -9 $$"])` → `exitCode: null` (typed `number`), `signalCode: "SIGKILL"`, `success: false`. `typeof syncResult.resourceUsage === "object"` vs `typeof proc.resourceUsage === "function"`.
why bad: Three divergent type spellings for one concept, two of them factually wrong, means `strictNullChecks` cannot save you from `syncResult.exitCode.toFixed()` and cannot tell you `onExit`'s third arg is a string. The method/property asymmetry on `resourceUsage` is gratuitous.
bun 2.0 proposal: One `signalCode: NodeJS.Signals | null` everywhere; `SyncSubprocess.exitCode: number | null`; make `resourceUsage` the same shape on both.
blast radius: low - types only (the `resourceUsage` unification is the only runtime change).
confidence: high.

### Interpolating `undefined`/`null` into `$` produces the literal words `"undefined"`/`"null"`, and the types permit it

what: `ShellExpression` includes `null | undefined` (inherited from `SpawnOptions.Readable`), so `$\`rm -rf ${dir}/sub\`` type-checks when `dir` is possibly-undefined and silently targets the path `undefined/sub`.
where: `/workspace/bun/packages/bun-types/shell.d.ts:2-10` (`ShellExpression = ... | SpawnOptions.Readable | SpawnOptions.Writable ...`); `/workspace/bun/packages/bun-types/bun.d.ts:6684-6685` (`Readable = ... | null | undefined | ...`).
evidence: Empirically: `await $\`echo [${undefined}/sub]\`.text()` → `"[undefined/sub]\n"`; `null` → `"[null/sub]"`. A plain `{}` *does* throw ("Invalid JS object used in shell: [object Object], you might need to call `.toString()` on it") - so the shell already has a hard-error path for bad interpolands, it just exempts the two most dangerous values. `google/zx` v8 throws on `undefined` interpolation; bash expands an unset var to nothing. Bun is a third, unique behavior.
why bad: The `Readable`/`Writable` unions are in `ShellExpression` so you can write `> ${buf}` redirects, but they drag `null|undefined|"pipe"|"ignore"|"inherit"` along as valid *words*, defeating the type checker for exactly the class of bug (an optional value leaking into a destructive shell command) the Bun Shell's escaping story is supposed to prevent.
bun 2.0 proposal: Throw at runtime on `undefined` interpolation (matching the existing plain-object error and zx), and split `ShellExpression` so redirect positions and word positions have different types.
blast radius: low - interpolating `undefined` on purpose to get the word "undefined" is not a real program.
confidence: high.

### Two call shapes for `spawn`/`spawnSync`, with `cmd:` silently ignored when both are given

what: `Bun.spawn(cmds[], opts?)` and `Bun.spawn({cmd, ...opts})` both exist (4 overloads ×2 functions); passing both (`Bun.spawn(["echo","ARRAY"], {cmd:["echo","OPTION"]})`) silently uses the array and discards `cmd`. Separately, the spawnSync *object* overload bans `onExit` (`onExit?: never`) while the *array* overload accepts it - and the runtime ignores it.
where: `/workspace/bun/packages/bun-types/bun.d.ts:7361-7417` and :7433-7490 (the 4 overloads); :7455 (`onExit?: never` only on the object overload of `spawnSync`); `/workspace/bun/docs/runtime/child-process.mdx:487-494`.
evidence: Empirically: `Bun.spawn(["echo","ARRAY"],{cmd:["echo","OPTION"]})` prints `ARRAY`. `Bun.spawnSync(["true"],{onExit(){called=true}})` type-checks and `called` stays `false`. The namespace itself records an earlier naming regret: bun.d.ts:6671-6674 `/** @deprecated use {@link Bun.Spawn} instead */ export import SpawnOptions = Spawn;` and :6708 `@deprecated use BaseOptions or the specific options...` on `OptionsObject` - two deprecated aliases kept only for back-compat, which also leaves `Bun.Spawn.SpawnOptions` as an interface inside a namespace whose deprecated alias is *also* named `SpawnOptions`.
why bad: Redundant call shapes double the documentation and overload count, create a silently-resolved conflict, and the `onExit` guard only covers one of the two spellings. Node has one shape (`spawn(cmd, args, opts)`).
bun 2.0 proposal: Keep `Bun.spawn(cmds[], opts?)` as the canonical shape and drop (or error on) the `{cmd}` object form; apply `onExit?: never` to both `spawnSync` overloads or make it an error at runtime; delete the `SpawnOptions`/`OptionsObject` deprecated aliases.
blast radius: medium - the object form is used in the wild (it's in half the docs' own examples).
confidence: high.

### `maxBuffer` sits on the shared options type but only works when Bun owns the pipe

what: `maxBuffer` is declared on `BaseOptions` (shared by `spawn` and `spawnSync`) with no qualification, but on async `spawn` it only triggers if *you don't* consume `stdout` (Bun's internal reader must hit the limit), and on `spawnSync` the kill happens *after* the full output was already buffered.
where: `/workspace/bun/packages/bun-types/bun.d.ts:7011-7017`; `/workspace/bun/docs/runtime/child-process.mdx:215-217` ("For `Bun.spawnSync`, `maxBuffer` limits..." - docs scope it to spawnSync only, the types don't).
evidence: Empirically, `maxBuffer: 10` on async `Bun.spawn` with `await proc.stdout.text()` returned all 100 000 bytes, exit 0, not killed; the same spawn with stdout *not* drained was SIGTERM'd. `Bun.spawnSync(..., {maxBuffer: 10})` set `exitedDueToMaxBuffer: true` but `stdout.length === 100000` - the "limit" didn't limit anything.
why bad: A limit whose enforcement depends on whether the caller happened to read the stream is not a limit; the `.d.ts` and the user docs disagree about which function it even applies to. In Node, `maxBuffer` is an `exec`/`execFile` concept and doesn't exist on raw `spawn` at all.
bun 2.0 proposal: Either move `maxBuffer` to `SpawnSyncOptions` only (matching the docs) and have it truncate/error like Node's, or make it a real byte cap that `spawnSync` honors.
blast radius: low - `maxBuffer` is rarely used with async `spawn`.
confidence: medium (the exact async semantics depend on the internal-reader race; the doc/type disagreement is certain).

### `kill()`'s signal parameter is named `exitCode`; `onExit` can fire before `spawn` returns

what: `Subprocess.kill(exitCode?: number | NodeJS.Signals)` names the *signal* parameter `exitCode`; and the `onExit` callback is documented as possibly firing before `Bun.spawn` has returned, so the idiomatic `const proc = Bun.spawn(c, {onExit(){ use(proc) }})` is a documented TDZ hazard.
where: `/workspace/bun/packages/bun-types/bun.d.ts:7276-7280` (`@param exitCode Exit code or signal to send to the process`); bun.d.ts:6830-6836 (`Warning: this may run before the \`Bun.spawn\` function returns.`).
evidence: Both are verbatim quotes from the `.d.ts`. The user docs (`child-process.mdx:146-147`) show `proc.kill(15)` / `proc.kill("SIGTERM")` - both are signals, never exit codes.
why bad: The name `exitCode` on a signal argument is a straight naming error that IDE hovers and generated docs now propagate; the `onExit` ordering caveat is a wart the `subprocess` first argument was added to paper over.
bun 2.0 proposal: Rename the parameter to `signal` (zero runtime change); always defer `onExit` to at least a microtask after `spawn` returns.
blast radius: low (param name) / low (deferring `onExit` one tick is observationally equivalent for almost everyone).
confidence: high.

### `argv0` JSDoc documents the inverse of what it does (and of what Node does)

what: The `.d.ts` describes `argv0` as "Path to the executable to run in the subprocess" with `@default cmds[0]` - implying `cmd[0]` is the fake name and `argv0` is the binary - but at runtime Bun (correctly, like Node) resolves `cmd[0]` as the executable and `argv0` only sets the child's reported `argv[0]`.
where: `/workspace/bun/packages/bun-types/bun.d.ts:6939-6946`.
evidence: Verbatim JSDoc: `/** Path to the executable to run in the subprocess. / Use this to wrap another application or to simulate a symlink. / @default cmds[0] */`. Empirically, `Bun.spawn({cmd:["I-AM-ARGV0",...], argv0: nodePath})` fails with `Executable not found in $PATH: "I-AM-ARGV0"` (so `argv0` is NOT the executable), and `Bun.spawn({cmd:[nodePath,...], argv0:"I-AM-ARGV0"})` gives the child `process.argv0 === "I-AM-ARGV0"` - identical to `node:child_process`'s `argv0`.
why bad: The runtime is right and the documentation is wrong, so anyone who trusts the types will pass the executable path in `argv0` and get `ENOENT`.
bun 2.0 proposal: Doc-only fix (no breaking change needed); included because the 2.0 audit is the natural time to reconcile all the spawn docstrings.
blast radius: low - documentation only.
confidence: high.

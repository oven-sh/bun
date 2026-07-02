# Bun 2.0 candidates: `bun:sqlite`

All file paths are relative to the repo root `/workspace/bun`. All runtime behaviors below were
reproduced on Bun 1.4.0.

### Named-parameter prefix + `strict` conflate two unrelated decisions, and both defaults are wrong

what: By default callers must include the `$`/`:`/`@` prefix in binding-object keys AND a missing/typo'd named parameter silently binds `NULL`; `strict: true` flips BOTH at once and additionally *rejects* prefixed keys, so no single binding object works in both modes.
where: `src/jsc/bindings/sqlite/JSSQLStatement.cpp:944` (`const bool throwOnMissing = trimLeadingPrefix;` - one flag drives both behaviors), `:55` (`kStrictFlag`), `:1675`; `src/js/bun/sqlite.ts:396-403`; `packages/bun-types/sqlite.d.ts:62-84`; `docs/runtime/sqlite.mdx:79-94,278-297`.
evidence: PR #11887 ("Support unprefixed bindings, safe integers / BigInt, `as(Class)`") closes 7 issues in one go (#5661, #5261, #6591, #5256, #1536, #8284, #3284) by adding `strict` as an opt-in in v1.1.14 - two years after launch. Issue #13409 (OPEN): "`bun:sqlite` in strict mode to accept parameters with and without prefix … This is actually the behaviour I expected when I read the documentation … The key word being 'allow', and not 'require'." Reproduced: `db.run("INSERT INTO t (b) VALUES ($b)", { $c: "oops" })` inserts `{"b":null}` with no error; `{ b: "no-prefix" }` also inserts `NULL`; in strict mode `{ $b: "x" }` throws `Missing parameter "b"`. docs/runtime/sqlite.mdx:79 itself states the default: "does not throw an error if a parameter is missing."
why bad: Silent-NULL-on-typo is data corruption by default. The prefix requirement diverges from better-sqlite3 (the API Bun credits as its inspiration, docs/runtime/sqlite.mdx:20), which requires keys *without* the prefix, and from Node's `node:sqlite`, which accepts bare names by default (`setAllowBareNamedParameters` default `true`) while still accepting prefixed names. Because Bun's two modes are mutually exclusive, a library cannot accept a user-supplied `Database` of unknown strictness (#13409's exact complaint).
bun 2.0 proposal: Make strict the only behavior: always throw on missing parameters, and accept keys both with and without the prefix (Node semantics). Delete the `strict` option or keep it as a no-op. Internally, split `trimLeadingPrefix` and `throwOnMissing` into two flags.
blast radius: high - any non-strict code that relied on silent `NULL` for optional params breaks loudly; code already using `{strict: true}` + prefixed keys starts working instead of throwing.
confidence: high.

### `.query()` hands out a shared mutable cached `Statement` with an undocumented hard cap of 20

what: `db.query(sql)` returns the *same* `Statement` object for the same SQL, so `.as(Class)` and `.safeIntegers()` on it mutate every other caller's result shape; after 20 distinct SQL strings seen on the `Database`, caching silently stops forever and `db.query()` degrades into `db.prepare()`.
where: `src/js/bun/sqlite.ts:551` (`static MAX_QUERY_CACHE_SIZE = 20;` - a public, writable static), `:566` (`const willCache = this.#cachedQueriesKeys.length < Database.MAX_QUERY_CACHE_SIZE;`), `:224-228` (`as()` mutates the underlying native statement in place).
evidence: Reproduced: `db.query(s) === db.query(s)` is `true`; `db.query("SELECT b FROM t").as(Row)` makes a *later* `db.query("SELECT b FROM t").get()` return a `Row`; after 25 distinct queries, `db.query(s) === db.query(s)` is `false`. Neither the 20-entry cap, the "first 20 win" (non-LRU) policy, nor `MAX_QUERY_CACHE_SIZE` appear anywhere in `docs/runtime/sqlite.mdx` or `packages/bun-types/sqlite.d.ts`. Issue #24424: "Clarification on Bun SQLite differences between prepare and query wrt caching"; #28911 (OPEN): "bun:sqlite memory growth with dynamic query text can OOM 1GB container (in-memory DB)".
why bad: `.query()` is the headline API in the first docs example, and it is the only one of the pair that doesn't exist in better-sqlite3 or `node:sqlite`. Object identity + mutating configuration methods means one module's `.as()`/`.safeIntegers()` call silently rewrites another module's results. The cliff at 21 distinct queries is an invisible performance and memory-lifecycle change (`SQLITE_PREPARE_PERSISTENT` is only set when caching).
bun 2.0 proposal: Either (a) remove `.query()` and keep only `.prepare()` like the two reference APIs, or (b) make `.query()` return a cheap wrapper per call (sharing the compiled `sqlite3_stmt` but not the JS config), use a real LRU, document the cap, and make `MAX_QUERY_CACHE_SIZE` a constructor option instead of a writable static.
blast radius: medium - code that *relies* on `.query()` identity/mutation is rare; the cache policy change is observable only through `===` and memory.
confidence: high.

### `safeIntegers` defaults to silent int64→double truncation, and the team scaffolded - then abandoned - a 1.2 default flip

what: By default, INTEGER columns above 2^53 are silently rounded to the nearest double; the fix (`safeIntegers: true`) was bolted on in v1.1.14 as opt-in.
where: `packages/bun-types/sqlite.d.ts:55` ("When `false`, integers are returned as `number` and truncated to 52 bits."), `src/jsc/bindings/sqlite/JSSQLStatement.cpp:160-164` (`jsNumberFromSQLite` converts `int64_t` via `jsNumber`), `:57-59`.
evidence: JSSQLStatement.cpp:57-59 contains `#ifndef BREAKING_CHANGES_BUN_1_2 / #define BREAKING_CHANGES_BUN_1_2 0` and `test/harness.ts:18` has `export const BREAKING_CHANGES_BUN_1_2 = false;` - both added by PR #11887 (the same PR that added `safeIntegers`) and never used; the planned 1.2 break never shipped. Issues #5661 ("bun:sqlite truncates integers that cannot fit in a double"), #1536 ("configurable javascript runtime type for sqlite integers"), #5256. Reproduced: storing `990760989492400188` and reading it back returns `990760989492400100`.
why bad: Silent precision loss on reads is data corruption. Node's `node:sqlite` throws for out-of-range integers by default rather than corrupting them, so Bun's default diverges from the platform API it is converging toward. The shipping `.d.ts` even admits the truncation as the documented contract.
bun 2.0 proposal: At minimum, throw on read of an integer outside `Number.isSafeInteger` range when `safeIntegers` is `false` (matching `node:sqlite`); ideally default `safeIntegers: true`.
blast radius: medium - only affects databases that actually contain >2^53 integers; those users are already getting wrong answers.
confidence: high.

### `Database(path, {…})` option flags use truthiness instead of presence: empty/explicit-default options throw, and `create` silently overrides `readonly`

what: `new Database(path, {})`, `{readonly: false}`, and `{create: false}` all throw `SQLiteError: bad parameter or other API misuse`; `{readonly: true, create: true}` silently opens read-write.
where: `src/js/bun/sqlite.ts:379-409` - `flags = 0` is assigned whenever `options` is an object (`:380`), `options.readonly`/`options.create`/`options.readwrite` are tested truthily, `if (options.create)` (`:388`) *overwrites* the readonly flag, and the `flags === 0` fallback (`:406-408`) only runs `if ("strict" in options || "safeIntegers" in options)`.
evidence: Issue #15876 (OPEN): "new Database with { create: false } throws SQLITE_MISUSE". Reproduced all four cases above on 1.4.0, including `readonly+create -> WRITE SUCCEEDED (readonly ignored)`. The file already contains a hand-rolled misspelling guard (`"readOnly" in options`, `:386`) - evidence the team knows these options are a trap - but not the presence check.
why bad: Explicitly writing the documented default value of an option (`packages/bun-types/sqlite.d.ts:122` says the default is `{readwrite: true, create: true}`) breaks the constructor with a cryptic C-level error. And a user who asked for `readonly: true` can get a writable handle. This is the "treat empty, zero, and unset as three distinct states" class.
bun 2.0 proposal: Compute flags from `?? default` on each option, make `readonly: true` win over `create`/`readwrite` (or throw on the contradiction), and drop the `options?: number` raw-flags overload (`sqlite.d.ts:124`) in favor of `constants.*`.
blast radius: low - today's behavior on these inputs is a throw or a silent surprise; nobody depends on it.
confidence: high.

### `Statement.get()` returns `null` where the docs, better-sqlite3, and `node:sqlite` all say `undefined`

what: `.get()` with no matching row returns `null`; Bun's own docs say `undefined`.
where: `src/jsc/bindings/sqlite/JSSQLStatement.cpp:2297` (`JSValue result = jsNull();` in `jsSQLStatementExecuteStatementFunctionGet`); `packages/bun-types/sqlite.d.ts:626,656` (`ReturnType | null`, "this returns `null`"); `docs/runtime/sqlite.mdx:327` ("If the query returns no rows, `undefined` is returned.").
evidence: Reproduced: `db.query("SELECT * FROM t").get() === null` is `true`. Issue #11099 ("incorrect docs for bun:sqlite Statement.get") is a prior report that this method's docs were copy-pasted and wrong. better-sqlite3's `Statement#get()` and Node's `sqlite.StatementSync#get()` both return `undefined`.
why bad: The docs and the runtime disagree today, and both reference APIs Bun might want to be compatible with chose the other sentinel. The difference bites `=== undefined` checks and destructuring defaults (`const { x = 1 } = stmt.get()` throws on `null`, works on `undefined`).
bun 2.0 proposal: Return `undefined` for no-row; update the `.d.ts` to `ReturnType | undefined`.
blast radius: medium - `stmt.get() === null` checks in existing code break silently; `== null` and truthiness checks are unaffected.
confidence: high.

### Non-object/array bindings are silently discarded, and only the first of a multi-statement string gets bindings

what: `db.prepare(sql, scalar)` silently binds `NULL`; `db.prepare("A; B; C")` silently compiles only `A` and drops `B; C`; `db.run("INSERT (?); INSERT (?)", [v])` binds only the first statement and leaves the second `NULL` - none of these throw.
where: `src/jsc/bindings/sqlite/JSSQLStatement.cpp:1679` (`if (bindings.isObject())` - non-objects fall through with no error), `:1661` (`sqlite3_prepare_v3(..., &statement, nullptr)` - the tail is never examined), `:1507` ("// First statement gets the bindings."); `src/js/bun/sqlite.ts:547-549` (`prepare()` forwards `params` without the auto-wrapping heuristic `Statement#get/all/run` use at `:237-239`).
evidence: Issue #25472 (OPEN): "bun:sqlite Database.prepare ignores single binding argument, only array bindings work … Actual: `INSERT INTO test (name) VALUES (NULL)`" - and the `.d.ts` signature `prepare(sql, params?: ParamsType)` where `ParamsType extends SQLQueryBindings | SQLQueryBindings[]` (`sqlite.d.ts:242-245`) type-checks the broken call. Issue #3283 (closed 2024-02): "SQLite silently drops statements in multi-statement query … `better-sqlite3` … throws an error when using `db.prepare()`" - the `db.run()` half was fixed; the `db.prepare()`/`db.query()` half was not (reproduced on 1.4.0: `db.prepare("A;B;C").run()` executes only `A`). Reproduced the multi-statement-binding case: `[{"b":"x"},{"b":null}]`.
why bad: Three distinct "accept bad input, do the wrong thing silently" paths, all in code that writes user data. The `prepare(sql, params)` pre-bind overload is a Bun-only invention (better-sqlite3's and node:sqlite's `prepare()` take one argument) that exists nowhere in `docs/runtime/sqlite.mdx` and is inconsistent with how every `Statement` method normalizes its arguments.
bun 2.0 proposal: Throw `TypeError` on non-object/non-array bindings everywhere; throw on a multi-statement string passed to `prepare()`/`query()` (better-sqlite3 behavior) or at least on a non-whitespace tail; either drop the `prepare(sql, params)` overload or run it through the same normalization as `Statement#run`.
blast radius: low - all current behaviors on these inputs are bugs nobody can be relying on intentionally.
confidence: high.

### `SQLiteError` is a fake class: `instanceof` is spoofed by name, the prototype chain is a lie

what: Errors thrown by `bun:sqlite` are plain `Error` instances with `name` set to `"SQLiteError"`; the exported `SQLiteError` class's constructor throws, and `instanceof` only works because of a `Symbol.hasInstance` override that string-compares `.name`.
where: `src/js/bun/sqlite.ts:685-696` ("// This class is never actually thrown / // so we implement instanceof so that it could theoretically be caught", `static [Symbol.hasInstance](instance) { return instance?.name === "SQLiteError"; }`, `constructor() { … throw new Error("SQLiteError can only be constructed by bun:sqlite"); }`); `src/jsc/bindings/sqlite/JSSQLStatement.cpp:325-357` (`createSQLiteError` builds a plain `JSC::createError` and `putDirect`s `name`).
evidence: The in-source comment is an explicit admission. Reproduced: for a thrown SQLite error `e`, `e instanceof SQLiteError === true` but `Object.getPrototypeOf(e) === SQLiteError.prototype` is `false` and `e.constructor.name === "Error"`. `packages/bun-types/sqlite.d.ts:1256` declares `export class SQLiteError extends Error` - which is not what gets thrown. Issue #4201: "bun:sqlite error messages are a mess".
why bad: Any error-handling code that keys on the prototype chain, `e.constructor`, `Error.captureStackTrace`-style subclass tricks, or structured-clone/serialization of the class identity gets the wrong answer. An empty object with `name: "SQLiteError"` also satisfies `instanceof SQLiteError`. better-sqlite3's `SqliteError` is a real `Error` subclass.
bun 2.0 proposal: Register a real `SQLiteError` structure in native code (the codebase already does this pattern for other generated classes) so thrown errors genuinely have `SQLiteError.prototype`; make the constructor usable; delete the `hasInstance` hack.
blast radius: low - `instanceof` and `.name` keep working; only prototype-identity checks change (to become correct).
confidence: high.

### `Statement.raw()` reuses better-sqlite3's method name for a completely different (and odd) behavior

what: Bun's `Statement.raw()` returns every cell as a `Uint8Array` of its raw encoding (INTEGER → 8 little-endian bytes, FLOAT → 8 IEEE-754 bytes, TEXT → UTF-8 bytes); in better-sqlite3, `stmt.raw()` is a chainable toggle meaning "return rows as value arrays instead of objects" - which is exactly what Bun already calls `.values()`.
where: `packages/bun-types/sqlite.d.ts:737-759` (`raw(...params): Array<Array<Uint8Array | null>>`); `src/jsc/bindings/sqlite/JSSQLStatement.cpp:515-545` (`toJSAsBuffer`), `:2410` (`jsSQLStatementExecuteStatementFunctionRawRows`).
evidence: Added 2025-08-19 by `784271f85e` "SQLite in Bun.sql (#21640)" as plumbing for the `Bun.sql` SQLite adapter, but placed on the public `Statement` class and `.d.ts`. Reproduced: `stmt.raw()` → `[[Uint8Array("hi"), Uint8Array([42,0,0,0,0,0,0,0])]]` while `stmt.values()` → `[["hi",42]]`. `.raw()` does not appear anywhere in `docs/runtime/sqlite.mdx`.
why bad: `bun:sqlite`'s stated goal is better-sqlite3 compatibility ("Credit to better-sqlite3 … for inspiring the API", docs/runtime/sqlite.mdx:20). Code ported from better-sqlite3 that calls `stmt.raw().all()` gets a `TypeError`, and `stmt.raw()` alone returns binary garbage instead of rows. The collision is gratuitous - the feature is internal plumbing for a different API.
bun 2.0 proposal: Remove `raw()` from the public `Statement`/`sqlite.d.ts` (keep it as a private binding for `Bun.sql`), or rename it (`rawBytes()`), so a future better-sqlite3-compatible `raw()` toggle is possible.
blast radius: low - added ~1 year ago, undocumented, and its output is not useful to ordinary callers.
confidence: high.

### `.run().changes` is computed from `sqlite3_total_changes()`, so it includes trigger / foreign-key-action rows

what: `Statement.run()` and `Database.run()` report `changes` as `sqlite3_total_changes(after) - sqlite3_total_changes(before)`, which counts rows changed by triggers and FK actions; better-sqlite3's documented contract for `info.changes` is `sqlite3_changes()`, which explicitly excludes them.
where: `src/jsc/bindings/sqlite/JSSQLStatement.cpp:2535,2562-2564` (`Statement.run`), `:1478,1545-1547` (`Database.run`).
evidence: Reproduced: with an `AFTER INSERT` trigger that inserts 2 log rows, `stmt.run(...).changes === 3` (1 + 2). The surrounding API has a history of churn: `Statement.run()` returned nothing until v1.1.14 (#8284 "Statement.run returns void instead of object", #3284 "return the number of rows changed"), was immediately broken (#12012 "changes … is always zero"), and the docs still said ".run() … get back `undefined`" until commit `cea59d7fc0` (Dec 2025, PR #25060).
why bad: `changes` lies about the row count of the statement you ran whenever triggers or cascading FKs are present, and it silently disagrees with the API Bun is modeled on and with `node:sqlite` (whose `changes` is also `sqlite3_changes()`). The value of a multi-statement `db.run()` is also the *sum* across all statements, which the docs don't mention.
bun 2.0 proposal: Use `sqlite3_changes64()` for `Statement.run()`; keep the total-delta only for multi-statement `Database.run()` (or document it). Type `Changes.changes` as `number | bigint` is already correct for `lastInsertRowid`.
blast radius: low - only differs when triggers/FK actions fire; those callers are getting a surprising number today.
confidence: medium - the divergence is verified; whether it was an intentional trade-off is not documented anywhere.

### `db.exec` is a `@deprecated` alias of `db.run` that collides with better-sqlite3's real `exec`

what: `Database.exec` is literally `Database.prototype.run` under another name, and the types already mark it `@deprecated`; in better-sqlite3, `db.exec(sql)` is a *different* API (multi-statement script runner, rejects bindings, returns `this`).
where: `src/js/bun/sqlite.ts:631` (`Database.prototype.exec = Database.prototype.run;`); `packages/bun-types/sqlite.d.ts:188-193` ("This is an alias of {@link Database.run} / @deprecated Prefer {@link Database.run}").
evidence: The `@deprecated` tag has been in the shipping types with no removal path. `Database.open` (`sqlite.d.ts:132-136`, "This is an alias of `new Database()`") is the same pattern. Reproduced: `db.exec === db.run` is `true`.
why bad: A permanently-deprecated alias is pure surface. Worse, it shadows the method name better-sqlite3 and `node:sqlite` use for "run a multi-statement script", so ported code calling `db.exec(bigMigrationScript)` happens to work only by coincidence (Bun's `run` is multi-statement) while getting a deprecation warning in editors, and `db.exec(sql, bindings)` means something neither reference API allows.
bun 2.0 proposal: Remove the `Database.open` static. Either delete `exec` or repurpose it to match `node:sqlite`'s `exec(sql): void` (multi-statement, no bindings) so `run` can become single-statement like the reference APIs.
blast radius: low for `Database.open`; medium for `exec` (widely used as a `run` synonym).
confidence: high (the `@deprecated` tag is the team's own statement).

### `Database.deserialize(buf, isReadOnly: boolean)` positional-boolean overload kept only for back-compat

what: The second argument to `Database.deserialize` is either a bare boolean (`isReadOnly`) or an options object; the boolean form predates `strict`/`safeIntegers` and is now an ambiguous overload the code special-cases.
where: `src/js/bun/sqlite.ts:462-474` (`if (typeof options === "boolean") { // Maintain backward compatibility with existing API`); `packages/bun-types/sqlite.d.ts:480` and `:550-553` (two overloads).
evidence: The in-source comment at `sqlite.ts:467` is an explicit "backward compatibility" admission. The options-object overload was added by `7d69ac03ec` "Enable passing options to Database.deserialize to enable strict mode (#17726)" to close issue #17689 ("`bun:sqlite` deserialize into strict mode") - i.e., the original boolean-positional signature could not be extended and had to be overloaded around.
why bad: Boolean positional flags are an acknowledged anti-pattern, and the d.ts now has to carry two `deserialize` overloads plus a 100-line duplicated JSDoc example. `deserialize(buf, true)` and `deserialize(buf, { readonly: true })` mean the same thing.
bun 2.0 proposal: Drop the boolean overload; accept only the options object.
blast radius: low - `deserialize` is a niche API and the options form has existed since v1.2.x.
confidence: high.

### Explicit regret markers in the shipping types: `close()`'s default, the phantom `native` export, and untyped escape hatches

what: The `.d.ts` itself documents three things the team wishes were different, and one of them (`export var native`) doesn't even exist at runtime.
where: `packages/bun-types/sqlite.d.ts:288` - `close(throwOnError?)`: "In the future, Bun may default `throwOnError` to `true`, but for backwards compatibility it is `false` by default."; `:1228-1240` - `export var native: any;` with "If you need to use it directly, let us know; that probably points to a deficiency in this API."; `:922-934` - `Statement.native: any`, "left untyped because the ABI of the native bindings may change at any time"; `:304-309` - `Database.handle: number`, "not a file descriptor, but an index into an array of database handles".
evidence: Reproduced: `"native" in (await import("bun:sqlite")) === false` - `src/js/bun/sqlite.ts:698-705` exports only `{Database, Statement, constants, default, SQLiteError}`, so `import { native } from "bun:sqlite"` type-checks but is `undefined`. Separately, `Statement#safeIntegers(v?)` exists and works at runtime (`src/js/bun/sqlite.ts:215-222`, confirmed) but is absent from the public `.d.ts` `Statement` class - the inverse problem.
why bad: `close()`'s default of `false` means a `close()` with live statements silently defers (via `sqlite3_close_v2`, JSSQLStatement.cpp:1816) instead of erroring - the team has said in the types they want the opposite. `export var native` is dead API surface that lies to the compiler. `Statement.native`/`Database.handle` bake "the native ABI may change at any time" into the public contract. `Statement#safeIntegers()` is a real, useful method with no type.
bun 2.0 proposal: Default `close(throwOnError)` to `true`. Delete `export var native` from the `.d.ts`. Remove `Statement.native` and `Database.handle` from the public types (or brand them `unique symbol`-opaque). Add `safeIntegers(toggle?: boolean): this | boolean` to `Statement` in the `.d.ts`.
blast radius: low for the type cleanups; medium for the `close()` default (code that leaks statements and then closes will start throwing).
confidence: high - these are the team's own words in the shipping `.d.ts`.

### Duplicate column names are silently dropped with no escape hatch

what: `SELECT a.id, a.v, b.id, b.v FROM a, b` returns only `{id, v}` - the earlier duplicates are silently discarded from `.get()`/`.all()` objects.
where: `src/jsc/bindings/sqlite/JSSQLStatement.cpp:742-752` (reverse iteration + `validColumns` BitVector: last duplicate wins, earlier ones are never emitted); `:490-492`.
evidence: Reproduced: `.get()` → `{"id":2,"v":"fromB"}` while `.values()` on the same query → `[[1,"fromA",2,"fromB"]]`. Issue #6837 (OPEN): "SQLite: Incorrect foreign key if column names match"; #13683 (closed as duplicate-class); #5261 (closed - fixed the *direction* of the merge to last-wins in PR #11887, matching better-sqlite3, but not the silent drop).
why bad: JS objects can't have two `id` keys, so *some* loss is inherent - but Bun provides no equivalent of better-sqlite3's `stmt.expand()` (namespace-by-table) or a warning, so joins quietly return wrong data and the only workaround is `.values()` plus manual indexing.
bun 2.0 proposal: Add an opt-in `expand()`-style mode (or throw on ambiguous columns, like some drivers do); at minimum document the last-wins rule in `docs/runtime/sqlite.mdx`, which currently never mentions it.
blast radius: low - additive (or documentation).
confidence: medium - the current last-wins behavior matches better-sqlite3; the regret is the absence of an escape hatch, which is an omission rather than a wrong default.

---

## Not included (considered and rejected)

- `db.transaction()` silently committing before an `async` callback resolves (#24662 OPEN) - real footgun, but `src/js/bun/sqlite.ts:598-599` says the code is "largely copied from better-sqlite3", which has the same limitation; not a Bun-specific design regret.
- `.values()` on a write-only statement returning `null` instead of `[]` (reproduced; `JSSQLStatement.cpp:2359,2394-2398`, with a `// breaking change in Bun v0.6.8` comment) - a type-contract bug (`sqlite.d.ts:735` promises an array) rather than a deliberate design.
- `Statement<ReturnType, ParamsType>` generic order (issue #23165) - the issue turned out to be a docs/reference mismatch, not an API-shape complaint.

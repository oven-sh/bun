# Bun 2.0 candidates - Bun.file / BunFile / Bun.write / stdio

All behavior below was verified empirically against Bun 1.4.0 and cross-checked against the
current source at /workspace/bun HEAD. Issue numbers verified via `gh`.

### Blob, File, and BunFile are one native class; `Blob.prototype` carries 11 non-standard members

what: `Bun.file()`, `new File()`, and `new Blob()` all produce instances of the same native `Blob` class, so every BunFile-only method lives on the web-standard `Blob.prototype`, and `File.prototype === Blob.prototype`.
where: `/workspace/bun/src/runtime/webcore/response.classes.ts:158-207` (the single `Blob` class definition with `exists`, `unlink`, `delete`, `write`, `writer`, `stat`, `name`, `lastModified`, `json`, `formData`, `image` on it); `/workspace/bun/src/jsc/bindings/JSDOMFile.cpp:13-64`; `/workspace/bun/src/runtime/webcore/Blob.rs:2191,2239`.
evidence:
- `response.classes.ts:179-180` and `:188-189`: `// TODO: Move this to a separate `File` object or BunFile` / `// This is *not* spec-compliant.` (on `name` and `lastModified`).
- `response.classes.ts:194`: `// Non-standard, s3 + BunFile support` (on `unlink`/`delete`).
- `JSDOMFile.cpp:13-14`: `// TODO: make this inehrit from JSBlob instead of InternalFunction // That will let us remove this hack for [Symbol.hasInstance] and fix the prototype chain.`
- `JSDOMFile.cpp:50-51`: `// This is not quite right. But we'll fix it if someone files an issue about it.` → `putDirect(vm, vm.propertyNames->prototype, zigGlobal->JSBlobPrototype(), ...)` - `File.prototype` IS `Blob.prototype`.
- `JSDOMFile.cpp:61`: `// Note: this breaks [Symbol.hasInstance]`
- Verified: `Object.getOwnPropertyNames(Blob.prototype)` in Bun → `arrayBuffer, bytes, delete, exists, formData, image, json, lastModified, name, size, slice, stat, stream, text, type, unlink, write, writer, constructor`; Node → `constructor, type, size, slice, arrayBuffer, text, bytes, stream`. That is 11 non-standard members (`delete, exists, formData, image, json, lastModified, name, stat, unlink, write, writer`).
- Verified: `Object.getPrototypeOf(new File([],"x")) === Blob.prototype` → `true`; `new File([],"x").constructor === Blob` → `true`; `Object.prototype.toString.call(new File([],"x"))` → `"[object Blob]"`.
- Verified: `await new Blob().exists()` → `true`; `new Blob().lastModified` → `4503599627370495`.
- Issues (all OPEN, `confirmed bug`): #14102 "File symbol is `Blob` instead of `File`", #20700 "`Blob` has `name`". Also #5980 "`Bun.file` should extend `File` not `Blob`" (closed; Jarred: "I don't think we should do this. `File` is buffered. `Bun.file()` is lazy.") and #26967 "Bun.file(path) not return BunFile instance but Blob instance".
- An unmerged branch `origin/claude/fix-bunfile-class-26967` (commit `eb3d38dbde`) already implements the fix: "Create a separate BunFile class that extends Blob ... This ensures Bun.file().constructor.name returns 'BunFile' and plain Blob instances don't expose non-standard file methods. Also fixes the File prototype chain." It never landed - presumably because it's breaking.
why bad: It is an observable WHATWG File API violation on a web-standard global. Feature detection (`"name" in new Blob()`), `instanceof`, `Object.prototype.toString`, `constructor.name`, and library code that ships polyfills or brands on `File` all misbehave. There is also no exported `BunFile` class to `instanceof` against.
bun 2.0 proposal: Make `BunFile` a real class extending `File` extending `Blob` (exactly the unmerged branch). Move `exists/unlink/delete/write/writer/stat/json/formData/image` onto `BunFile.prototype`; move `name`/`lastModified` onto `File.prototype`. Expose `Bun.BunFile`.
blast radius: medium - code calling `new Blob(...).json()` / duck-typing on `Blob` members breaks, but `Bun.file()` users (the intended audience) keep working; the branch exists and passes tests.
confidence: high.

### Reading `.size` or calling `.exists()` permanently caches a size that silently corrupts later I/O

what: The first access to `.size` (or `.exists()`, which calls `resolve_size()` internally) memoizes the size onto the `BunFile` object forever; later `Bun.write`, `.text()`, and `.arrayBuffer()` use the stale value and silently truncate or write nothing.
where: `/workspace/bun/src/runtime/webcore/Blob.rs:2349-2368` (`get_size`), `:2370-2427` (`resolve_size`, with `self.size.set(0)` on stat failure at `:2423`), `:1309-1312` (`get_exists_sync` calls `resolve_size`); type doc at `/workspace/bun/packages/bun-types/bun.d.ts:2078-2080`.
evidence:
- Issue #4930 "Calling `BunFile.exists` makes `Bun.write` write nothing" - OPEN since Bun 1.0.0 (2023), reconfirmed by users on 1.2.9. A commenter diagnosed it: "Resolving `BunFile.size` (which `.exists()` does internally) seems to be the issue."
- Reproduced on 1.4.0: `const out = Bun.file('out.txt'); await out.exists(); await Bun.write(out, Bun.file('in.txt'))` → `out.txt` is 0 bytes. Remove the `exists()` call → 10 bytes.
- Reproduced a worse variant: write `"AAAA"`, `Bun.file(p)`, read `.size` (4), overwrite the file with 12 bytes → `await f.text()` returns only `"CCCC"` (4 bytes). Without the `.size` access the same sequence returns all 12 bytes.
- The `.d.ts` doc at `bun.d.ts:2078-2080` claims the opposite twice: "This Blob is lazy: it does no work until you read from it. `size` is not valid until the contents of the file are read at least once." In reality `.size` is a *synchronous blocking `stat()`* (`resolve_file_stat` at `Blob.rs:6313-6350`) and IS valid before any read - and then freezes.
- Bonus inconsistency: `Bun.file(realFile).slice(2,5).exists()` returns `false`, but returns `true` if the parent's `.size` was read first - the answer depends on unrelated prior property access (verified).
why bad: A property getter that looks like a cheap read both performs a blocking syscall and irreversibly changes the object's future I/O behavior. This is a 2.5-year-old open data-loss bug that cannot be fixed without either removing the cache (a perf regression the team clearly wants to avoid) or a semantic break.
bun 2.0 proposal: Either (a) stop memoizing - re-stat on every `.size` access and never feed the cached size into the read/write paths; or (b) adopt the File API snapshot model: stat once, then make a changed mtime/size reject reads with `NotReadableError` instead of silently truncating. Make `.size` async (`Promise<number>`) or move it to `await file.stat()` so the syscall is visible.
blast radius: medium - `.size` being sync is widely used, but the *value* only changes for files modified after the handle was created, which is exactly the broken case today.
confidence: high.

### `Blob.prototype.slice()` treats a string argument as `contentType`, breaking spec-mandated numeric coercion

what: Bun special-cases a string first/second argument to `slice()` as the MIME type, so `blob.slice("3")` returns the whole blob with `type === "3"` instead of slicing from index 3.
where: `/workspace/bun/src/runtime/webcore/Blob.rs:2079-2087` (`if args[0].is_string() { args[2] = args[0]; ... } else if args[1].is_string() { ... }`); the non-standard overloads are typed at `/workspace/bun/packages/bun-types/bun.d.ts:2124` (`slice(begin?: number, contentType?: string)`) and `:2131` (`slice(contentType?: string)`).
evidence:
- Verified divergence: `new Blob(["abcdef"]).slice("3").size` → Bun: `6` (and `.type === "3"`); Node 22 and browsers per the File API `start` → `ToIntegerOrInfinity`: `3`.
- `bun.d.ts:2106,2119`: the overload docs even admit a perf cost: "If `begin` > 0, `Bun.write()` is slower on macOS".
why bad: This is an observable spec violation on the global `Blob` (not just `BunFile`) that exists only to enable an API-sugar overload. Any code that passes a numeric string (e.g. from a query param or header) to `Blob.slice()` silently gets the full blob back.
bun 2.0 proposal: Remove the `slice(contentType)` and `slice(begin, contentType)` overloads; make `slice()` follow the spec's argument coercion. Keep `type` override available via `Bun.file(path, { type })`.
blast radius: low - almost nobody calls `slice("text/plain")`; the standard 3-arg form already covers it.
confidence: high.

### `BunFile.size` means four different things: `0` = "missing", `Infinity` = "pipe", `st_size` = "directory", `N` = "regular file"

what: `.size` conflates "does not exist" with "empty file" (both `0`), returns `Infinity` for non-seekable fds, and for a directory returns the inode's `st_size` (e.g. `4096`) even though `exists()` returns `false` for the same path.
where: `/workspace/bun/src/runtime/webcore/Blob.rs:2349-2368` (`get_size`: `return Infinity` branches), `:2420-2423` (`self.size.set(0)` on stat failure), `:1324-1328` (`get_exists_sync`: `ISREG || ISFIFO`); documented at `/workspace/bun/docs/runtime/file-io.mdx:48-52`.
evidence:
- `docs/runtime/file-io.mdx:49`: `notreal.size; // 0` - the "missing → 0" conflation is documented behavior.
- Verified on 1.4.0: `Bun.file(nonexistent).size` → `0`; `Bun.stdin.size` → `Infinity`; `Bun.file(fifo).size` → `Infinity`; `Bun.file("/tmp/adir").size` → `4096` while `await Bun.file("/tmp/adir").exists()` → `false`.
- `bun.d.ts:2169`: "For empty Blob, this always returns true." and `:2154-2156`: "It returns false for directories." - the type docs already apologize for the name.
- `resolve_file_stat` at `Blob.rs:6332-6334` swallows the stat error: `// the file may not exist yet. That's okay. _ => {}`.
why bad: `if (file.size)` and `if (await file.exists())` give contradictory answers for a directory, and `size === 0` cannot distinguish "empty" from "missing" from "stat failed (EACCES)". All errors are swallowed. `Blob.size` per spec is a concrete byte length; `Infinity` and "I silently failed" are not in its domain.
bun 2.0 proposal: Remove `.size` from the lazy path; route callers to `await file.stat()` (which already exists and surfaces real errors). If a sync getter stays, make it throw the stat error rather than returning `0`/`Infinity`. Rename `exists()` or change it to a real `access()` (directories exist).
blast radius: medium - `file.size` is common, but today it is already unreliable enough that robust code uses `stat()`.
confidence: high.

### `lastModified` returns the magic sentinel `4503599627370495` (2^52-1) and is bolted onto `Blob`

what: When the mtime is unknown (missing file, plain `Blob`), `lastModified` returns `(1 << 52) - 1`, i.e. a date in the year 144683 - instead of the spec's "`Date.now()` at construction" (`File`) or not existing at all (`Blob`).
where: `/workspace/bun/src/jsc/lib.rs:2109-2110`: `/// Maximum Date in JavaScript is less than Number.MAX_SAFE_INTEGER (u52). pub const INIT_TIMESTAMP: JSTimeType = (1u64 << 52) - 1;`; `/workspace/bun/src/runtime/webcore/Blob.rs:2240-2264` (`get_last_modified`); typed at `/workspace/bun/packages/bun-types/bun.d.ts:2142-2145`.
evidence:
- Verified: `new Blob().lastModified` → `4503599627370495`; `Bun.file(nonexistent).lastModified` → `4503599627370495`. (`new File([],"x").lastModified` is correct.)
- `MAX_SIZE` (`/workspace/bun/src/jsc/webcore_types.rs:34`) is the *same* `(1<<52)-1` constant, reused as both the "unknown size" and "unknown mtime" sentinel.
- `response.classes.ts:188-189`: `// TODO: Move this to a separate File object or BunFile // This is *not* spec-compliant.`
- `bun.d.ts:2145` declares `lastModified: number` with no `readonly`, but the runtime property has no setter (verified `Object.getOwnPropertyDescriptor(...).set === undefined`) - the type also lies.
why bad: Spec Blobs have no `lastModified`; a sentinel that is a valid (huge) number is worse than `undefined` or `NaN` because comparisons like `file.lastModified > cutoff` silently succeed. Reading it is also a hidden synchronous `stat()`.
bun 2.0 proposal: Remove `lastModified` from `Blob.prototype`. On `BunFile`, return `NaN` (or throw) when unknown, or expose it only through `await file.stat()`. Mark the type `readonly`.
blast radius: low - the sentinel is useless today so nothing correct depends on it.
confidence: high.

### `Bun.stdin` / `Bun.stdout` / `Bun.stderr` are `BunFile`, which is the wrong abstraction for non-seekable streams

what: The three stdio handles are plain `BunFile` (Blob) objects backed by fds 0/1/2, so they inherit `size`, `exists()`, `unlink()`, `delete()`, `text()`, `type`, `slice()`, `stat()` - almost all of which are nonsense or misleading for a pipe/tty - and the file-oriented write path leaks through.
where: `/workspace/bun/src/runtime/api/BunObject.rs:2993-3099` (`stdio_stores`: just `Blob::init_with_store(fd)`); typed at `/workspace/bun/packages/bun-types/bun.d.ts:4542-4554`.
evidence:
- Issue #13477 (OPEN) "Bun.write(Bun.stdout, "") tries to truncate on Windows" → `EISDIR: Is a directory, syscall: "ftruncate", fd: 1`. The regular-file truncation logic runs against fd 1 because `Bun.stdout` is just a `BunFile`.
- Issue #14874 (OPEN) "Allow overwriting Bun.stdout and Bun.stderr" - they are getter-only `const BunFile`, so users can't redirect them.
- Verified: `Bun.stdout.size` → `Infinity`; `Bun.stdout.type` → `"application/octet-stream"`; `await Bun.stdout.exists()` → `true`; `Bun.stdout.unlink()` throws **synchronously** (not a rejection) with `TypeError: Is not possible to unlink a file descriptor, code: "ERR_INVALID_ARG_TYPE"`, violating its own `Promise<void>` contract.
- Verified: `await Bun.stdin.text()` twice → first returns the input, second returns `""`. A `BunFile` on a regular file is re-readable; `Bun.stdin` silently is not, so the same method has two contracts.
- `Bun.stdout.writer()` returns a *new, independent* `FileSink` on every call (verified `w1 !== w2`), each with its own buffer on the same fd.
why bad: These are streams being forced through a Blob API. The type advertises dozens of operations that throw, lie, or are one-shot. Node/Deno expose stdio as `Writable`/`WritableStream`/`ReadableStream`, which is what they are.
bun 2.0 proposal: Make `Bun.stdout`/`Bun.stderr` expose a single stable `WritableStream` (plus `.write()` returning `Promise<void>` for backpressure) and `Bun.stdin` a `ReadableStream` + `.text()`. Drop `size`/`exists`/`unlink`/`slice` from them. Make them assignable (#14874).
blast radius: medium - `Bun.write(Bun.stdout, x)` and `for await (const c of Bun.stdin.stream())` are documented idioms and must keep working; everything else is little used.
confidence: high.

### `FileSink.write()`/`flush()`/`end()` return `number | Promise<number>`, and the number is a cumulative running total

what: `FileSink.write(chunk)` sometimes returns a `number` and sometimes a `Promise<number>`, and that number is the total bytes the sink has ever accepted - not this call's count - so it can exceed the chunk's length.
where: `/workspace/bun/packages/bun-types/s3.d.ts:7-67` (`FileSink` interface, `write(...): number | Promise<number>`); prototype generated at `/workspace/bun/src/codegen/generate-jssink.ts:1238-1254`.
evidence:
- Issue #12194 (OPEN, `bug`) "FileSink.write incoherencies": "1) I'd not expect `FileSink.write` to randomly return a promise  2) I'd definitely not expect `FileSink.write` to return a number greater than the size of the buffer I passed to it".
- The reference in `/workspace/bun/docs/runtime/file-io.mdx:299` contradicts the real type: `write(chunk: ...): number;` (no `Promise`).
- Verified: the prototype also has an *undocumented* `close()` method (returns `undefined`) alongside `end()` (returns the cumulative number), plus internal `_getFd` and `sinkId` leaked onto the prototype. `close` is absent from `s3.d.ts` and all docs.
- No `Symbol.dispose`/`Symbol.asyncDispose` (verified `undefined`), so `using`/`await using` cannot manage the most resource-like object in the API.
why bad: A maybe-sync-maybe-async return is the hardest possible contract to use correctly - most callers don't `await` it, so backpressure is silently ignored. A cumulative total makes the return value unusable for accounting. Two undocumented closing methods (`close` vs `end`) with different return types is pure confusion.
bun 2.0 proposal: Make `write()` always return `Promise<number>` (or `number` = bytes *queued* from this chunk, with an explicit `await writer.flush()` for backpressure). Delete `close()` or alias it to `end()` and document exactly one. Return this-call byte counts. Add `[Symbol.asyncDispose]`. Implement the `.d.ts`'s own TODO (`bun.d.ts:2138-2140`): `// TODO // readonly readable: ReadableStream<Uint8Array>; // readonly writable: WritableStream<Uint8Array>;` - expose a real `WritableStream` so `pipeTo` works.
blast radius: medium - `FileSink` is the only incremental-write API; a return-value change is visible but the sync/async split already forces defensive code.
confidence: high.

### Three write paths with three incompatible truncate/append behaviors and no option to choose

what: `Bun.write(file, data)` truncates; `file.writer()` (FileSink) does NOT truncate (it overwrites in place, leaving the tail); and there is no append mode at all.
where: `/workspace/bun/src/runtime/webcore/Blob.rs:1330-1408` (`do_write`), `/workspace/bun/src/runtime/webcore/FileSink.rs`; options typed at `/workspace/bun/packages/bun-types/bun.d.ts:1574-1587,2136,2178-2181`.
evidence:
- Issue #25968 (OPEN) "`FileSink` does not truncate existing file". Verified: pre-write 30 bytes, `writer().write("ab"); end()` → file contains `"abEEXISTING-LONG-CONTENT-12345"`.
- Issue #10473 (OPEN, `enhancement`, since 2024) "Support appending files with `Bun.write`". Issue #5821 (OPEN) "Add offset option to FileSink".
- Issue #31682 (OPEN) "Bun.write(Bun.file(path), s3file) does not truncate a larger existing destination file" - the truncation contract is inconsistent even between `Bun.write` source types.
why bad: The single most common file-writing decision - truncate vs append vs overwrite-in-place - is not a choice the user can make; it is an accident of which of the three entry points they picked, and one of them is data-corrupting by default.
bun 2.0 proposal: Give all three the same default (truncate) and a shared `{ append?: boolean }` / `{ truncate?: boolean }` option. `file.writer()` should truncate by default to match `Bun.write(file, ...)`.
blast radius: medium - changing `writer()` to truncate will break anyone relying on the current overwrite-in-place behavior, but that behavior is already an open bug.
confidence: high.

### `.unlink()` and `.delete()` are exact aliases, both on `Blob.prototype`

what: Two identically-behaving methods bound to the same native function on the web-standard `Blob` prototype; neither is deprecated.
where: `/workspace/bun/src/runtime/webcore/response.classes.ts:194-196`: `// Non-standard, s3 + BunFile support` → `unlink: { fn: "doUnlink", length: 0 }, delete: { fn: "doUnlink", length: 0 },`. Typed at `/workspace/bun/packages/bun-types/bun.d.ts:2183-2191` (`delete()` JSDoc literally reads "Deletes the file (same as unlink)").
evidence: the `response.classes.ts` lines above map both names to `doUnlink`. `delete` was added for the S3 work (`git log -S doUnlink`: `fe4176e403 feat(s3) s3 client (#15740)`). The docs (`file-io.mdx:69-75`) only teach `.delete()`; `unlink()` is undocumented there.
why bad: Two names for one operation is permanent API debt. Both also exist on `new Blob(["x"])`, where `await new Blob(["x"]).delete()` rejects with "Cannot write to a Blob backed by bytes" - a non-standard method on a standard class whose only possible outcome is an error.
bun 2.0 proposal: Keep `delete()` (it matches the S3/`Bun.S3File` sibling API and `Deno.remove`/`fs.rm` naming), deprecate-then-remove `unlink()`, and move it off `Blob.prototype` onto `BunFile.prototype`.
blast radius: low - one-line rename for callers.
confidence: high.

### `Bun.file()` dispatches on runtime type: number→fd, Uint8Array→path-bytes, `"s3://"`→S3File, and URL vs string validate differently

what: One function whose first argument means four unrelated things depending on its runtime type, including a magic string prefix that returns a different kind of object.
where: `/workspace/bun/packages/bun-types/bun.d.ts:4111` (`path: string | URL`), `:4152` (`path: ArrayBufferLike | Uint8Array<ArrayBuffer>` - "The path to the file as a byte buffer"), `:4168` (`fileDescriptor: number`); `/workspace/bun/src/runtime/webcore/Blob.rs:3784-3816` (the `s3://` prefix check).
evidence:
- Verified: `Bun.file(0)` → fd 0 (stdin); `Bun.file("0")` → the relative path `./0`. Opposite meanings one `String()` apart.
- Verified: `Bun.file(new TextEncoder().encode("/tmp/x"))` → the *path* `/tmp/x` as bytes, NOT a Blob of that content - the single most likely misread of this overload.
- Verified: `Bun.file(new URL("https://example.com/x"))` → throws `TypeError: URL must be a non-empty "file:" path`, but `Bun.file("https://example.com/x")` (the string form!) is silently accepted as the literal relative path `./https:/example.com/x` and `.exists()` → `false`. Issue #9506 (OPEN) "Improve error message when using non-`file:` URLs in `Bun.file`".
- Verified: `Bun.file("s3://bucket/key")` silently returns an S3-backed Blob with completely different semantics (network I/O, credentials) from the same call site.
why bad: Every one of these disambiguations is a footgun that TypeScript cannot catch at a dynamic call site (`Bun.file(x)` where `x: string | number`). The fd overload in particular should be `Bun.fdFile(fd)` or an option.
bun 2.0 proposal: `Bun.file(path: string | URL, opts?)` only. Move fds to `Bun.file({ fd })` or a distinct `Bun.fdFile()`. Reject (or at least warn on) non-`file:` schemes in the *string* form too. Make `s3://` require the explicit `Bun.s3.file()` / `new S3Client().file()` entry points that already exist.
blast radius: medium - `Bun.file(fd)` is documented; `s3://` auto-detection is advertised.
confidence: high.

### `Bun.write` and `BunFile.write()` share one implementation but declare different, both-wrong type signatures

what: The two entry points route to the same `write_file_internal`, yet `Bun.write`'s types omit `Request` (which works) and `BunFile.write()`'s types omit `Blob`, `BlobPart[]`, and `Archive` (which work); the runtime additionally stringifies any value whatsoever.
where: `/workspace/bun/packages/bun-types/bun.d.ts:1571-1588` (`Bun.write` input: `Blob | NodeJS.TypedArray | ArrayBufferLike | string | BlobPart[] | Archive`) vs `:2178-2181` (`BunFile.write` data: `string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer | Request | Response | BunFile`); impl at `/workspace/bun/src/runtime/webcore/Blob.rs:5108-5405` (`write_file_internal`, with the `Request` branch at `:5377-5383`).
evidence:
- Verified: `await Bun.write("/tmp/x", new Request("http://x/", {method:"POST", body:"request-body"}))` works and sets `req.bodyUsed = true`, despite `Request` not appearing in any `Bun.write` overload.
- Verified: `Bun.write("/tmp/o.txt", {a:1})` resolves to `15` and writes `"[object Object]"`. `Bun.write(p, 12345)` writes `"12345"`. `Bun.write(p, true)` writes `"true"`. Nothing in the type union admits any of these.
why bad: The type surface is a copy-paste fork of the implementation's accepted set, and both copies have drifted. The `toString()` fallback turns a type error (forgetting `JSON.stringify`) into silent file corruption.
bun 2.0 proposal: Derive one `Bun.WriteInput` type used by both, listing exactly the accepted set. At runtime, throw `ERR_INVALID_ARG_TYPE` for non-string, non-buffer, non-Blob, non-Response/Request objects instead of `toString()`ing them.
blast radius: low - strictening the fallback breaks only code already writing `[object Object]` to disk.
confidence: high.

### `BunFile.type` default disagrees with the Blob spec AND with Bun's own docs

what: The spec default for `Blob.type` is `""`; `Bun.file()` defaults to `"application/octet-stream"` for unknown extensions; the docs claim it defaults to `"text/plain;charset=utf-8"`. Three different answers.
where: `/workspace/bun/src/runtime/webcore/Blob.rs:6999-7005` (`b"application/octet-stream" // MimeType::OTHER`); `/workspace/bun/docs/runtime/file-io.mdx:54`: "The default MIME type is `text/plain;charset=utf-8`."
evidence: Verified: `Bun.file("/tmp/noext").type` → `"application/octet-stream"`; `Bun.file("/tmp/x.weirdext12345").type` → `"application/octet-stream"`; the doc example uses `notreal.txt` so its `"text/plain;charset=utf-8"` is the `.txt` mapping, not the default, and the prose generalizes it incorrectly. `new Blob(["a"]).type` → `""` (correct per spec).
why bad: `Bun.file(x).type === ""` is how portable code detects "unknown type"; Bun never produces it. The appended `;charset=utf-8` on inferred types is also non-standard (browsers produce the bare media type for `Blob.type`). And the project's own docs have the wrong answer, showing even the maintainers lost track.
bun 2.0 proposal: Default to `""` for unknown extensions (matching `Blob`) and stop appending `;charset=utf-8` to inferred types. Keep explicit `{ type }` untouched. Fix `file-io.mdx:54`.
blast radius: medium - `new Response(Bun.file(x))` Content-Type inference is a headline feature; that path can keep its own default without polluting `.type`.
confidence: medium (the `""` change is debatable; the doc contradiction and `;charset=` suffix are not).

### `FileBlob` is a dead legacy alias kept since an April 2023 rename, with no `@deprecated`

what: `interface FileBlob extends BunFile {}` exists only for back-compat with the pre-1.0 name.
where: `/workspace/bun/packages/bun-types/bun.d.ts:2074`.
evidence: PR #2581 "`FileBlob` -> `BunFile`, add `BunFile.lastModified`" (merged 2023-04-07). The alias has no JSDoc, no `@deprecated`, and is not in `deprecated.d.ts` alongside the 20+ other aliases that are.
why bad: It's an un-flagged legacy name that editors still autocomplete. Every other legacy alias in the types package is at least tagged.
bun 2.0 proposal: Move it to `deprecated.d.ts` with `@deprecated Renamed to BunFile` now; delete in 2.0.
blast radius: low.
confidence: high.

### Relative `Bun.file("x")` is re-resolved against the *live* cwd at read time

what: The relative path string is captured lazily and joined to whatever `process.cwd()` is when the read finally happens, so `process.chdir()` between creating and reading a `BunFile` changes which file it points at.
where: `/workspace/bun/src/runtime/webcore/Blob.rs:3818-3872` (`find_or_create_file_from_path` just stores the string via `to_thread_safe()`); documented only as "relative to cwd" at `/workspace/bun/docs/runtime/file-io.mdx:21`.
evidence: Verified: `cwd=/tmp/rp/a; const f = Bun.file("same.txt"); process.chdir("/tmp/rp/b"); await f.text()` → returns `/tmp/rp/b/same.txt`'s contents, not `/tmp/rp/a/same.txt`'s. Node's `fs.openAsBlob()` (the closest equivalent) opens eagerly and is immune.
why bad: A "file reference" that silently retargets on `chdir` is a time-of-check/time-of-use hazard, especially in test runners and CLI tools that `chdir` per-test. It is an unintended consequence of the lazy design, not a documented feature.
bun 2.0 proposal: Resolve relative paths against `process.cwd()` eagerly in `Bun.file()` (one `resolve()`, no syscall). Expose the resolved absolute path as `.name`.
blast radius: low - only observable if you `chdir` between create and read.
confidence: high.

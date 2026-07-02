# Bun 2.0 candidates - `Bun.*` namespace + non-standard extensions to web standards

All claims below were verified against the checkout at `/workspace/bun` and, where runtime behavior is asserted, empirically against the installed `bun 1.4.0` (with `node 26.3.0` as the Node baseline). File paths are absolute within the repo.

---

### `fetch` `keepalive` is hijacked for a different meaning than the spec
what: Bun repurposes the standard WHATWG `RequestInit.keepalive` flag to mean "HTTP connection pooling / Connection: keep-alive", which is not what the spec defines it as.
where: `/workspace/bun/src/runtime/webcore/fetch.rs:914-938`; `/workspace/bun/docs/runtime/networking/fetch.mdx:261` and `:469`.
evidence: Docs say verbatim: "Connection pooling is enabled by default but can be disabled per-request with `keepalive: false` or the `\"Connection: close\"` header." The WHATWG Fetch spec defines `keepalive` as "A boolean indicating whether or not the request can outlive the global in which it was created" (the `sendBeacon` use-case) - nothing to do with connection reuse. The parser at `fetch.rs:926-927` even accepts a *number* for `keepalive` (`keepalive_value.is_number()` → `to_int32() == 0`), which no spec permits. Issue #31463 ("fetch reuses sockets after `Connection: close`") shows the semantics are load-bearing.
why bad: This is a standard option name with silently different semantics. Code written for browsers/Node that sets `keepalive: true` for beacon semantics gets a different (harmless today) effect in Bun; code written for Bun (`keepalive: false` to disable pooling) is a no-op everywhere else. If Bun ever implements the real `keepalive`, the two meanings collide.
bun 2.0 proposal: Rename the pooling knob to a clearly non-standard name (e.g. `reuseConnection: false` or move it under `Bun.serve`/agent-level config) and leave `keepalive` with its WHATWG meaning (or as a no-op).
blast radius: medium - grep of real-world Bun code shows `keepalive: false` is a documented recipe, but it only affects performance, not correctness, so a rename is survivable.
confidence: high.

---

### Bun's `fetch()` extras don't survive `new Request()` - by the types' own admission
what: `proxy`, `unix`, `tls`, `s3`, `verbose`, `decompress`, `compress`, `maxRedirects`, `protocol` are only honored as a second argument to `fetch()`, not as `Request` init, which breaks every library that builds a `Request` and then calls `fetch(request)`.
where: `/workspace/bun/packages/bun-types/globals.d.ts:1918-1923` (`BunFetchRequestInit`).
evidence: The doc comment on the interface literally says: "These extensions are not part of `RequestInit` because they don't work when passed to `new Request()`." Open issue #6349 ("Support `new Request({ proxy })`") reports exactly this breaking `ky`, a popular fetch wrapper.
why bad: The web's composability contract is `new Request(url, init)` → `fetch(request)`. Bun added ~9 options that silently vanish on that path. Any fetch-wrapping library (ky, ofetch, openapi clients, MSW) loses all Bun-specific behavior - and the failure is silent.
bun 2.0 proposal: Either make all of them round-trip through `Request` (store on an internal slot `Request` carries), or move them off `RequestInit` entirely into a `Bun.Agent`/`dispatcher`-style object (Node/undici's design) so the limitation is structural and honest.
blast radius: medium - the options themselves would keep working at the `fetch()` call site; only the internal model changes.
confidence: high.

---

### Five overlapping module-resolution APIs, one of which the types admit is useless
what: `Bun.resolve`, `Bun.resolveSync`, `import.meta.resolve`, `import.meta.resolveSync`, and `require.resolve` all resolve specifiers, with inconsistent return forms and `parent` semantics; `Bun.resolve` and `import.meta.resolveSync` are self-admitted mistakes.
where: `/workspace/bun/packages/bun-types/bun.d.ts:1547-1556`; `/workspace/bun/packages/bun-types/globals.d.ts:1321-1328`.
evidence: `bun.d.ts:1554` on `Bun.resolve`: "Use {@link resolveSync} instead. **This async version has no performance benefit; it exists for future-proofing.**" `globals.d.ts:1326` on `import.meta.resolveSync`: "@deprecated Use `require.resolve` or `Bun.resolveSync(moduleId, path.dirname(parent))` instead". Verified at runtime: `import.meta.resolve(x)` returns a `file://` URL string, while `import.meta.resolveSync(x)` / `Bun.resolveSync(x, dir)` return a bare filesystem path - same verb, different return type. The `parent` arg is a file path in one and a directory in the other (that's why the deprecation message has to interpose `path.dirname`).
why bad: A `resolve`/`resolveSync` pair where the async one is explicitly pointless is the purest form of API regret the codebase states in its own words. The URL-vs-path and file-vs-dir inconsistencies between the same-named functions are footguns.
bun 2.0 proposal: Delete `Bun.resolve` and `import.meta.resolveSync`. Keep `import.meta.resolve` (standard) and, if a path-returning form is wanted, one `Bun.resolveSync(specifier, {parent})` whose `parent` semantics match `import.meta`.
blast radius: low - `Bun.resolve` has no advantage over `Bun.resolveSync`, and `import.meta.resolveSync` is already deprecated.
confidence: high.

---

### `Blob.type` and `Response.json()` Content-Type silently gain `;charset=utf-8`
what: Bun "promotes" well-known MIME types with a `;charset=utf-8` suffix at read time, diverging from the File API spec and from every other runtime.
where: `/workspace/bun/src/http_types/MimeType.rs:59-97` (`Compact::to_mime_type`); comment at `/workspace/bun/src/runtime/webcore/Blob.rs:866`: "The bare tag, *without* `;charset=UTF-8` (charset promotion is Compact::to_mime_type's job, applied when read)."
evidence: Verified: Bun `new Blob(["x"],{type:"text/plain"}).type` → `"text/plain;charset=utf-8"`; Node → `"text/plain"`. Bun `Response.json({}).headers.get("content-type")` → `"application/json;charset=utf-8"`; Node → `"application/json"`. Open issue #19603 ("different response blob type from node") is exactly this. The File API spec normalizes `type` to lowercase ASCII only; it never adds parameters. WHATWG `Response.json` mandates `application/json` exactly.
why bad: Any code that compares Content-Type with `===`, snapshot tests, or hashes derived from the type string differ between Bun and everything else. Strict servers/proxies can reject the altered value. It also means the round trip `new Blob(x, {type: t}).type !== t` for common `t`.
bun 2.0 proposal: Stop parameter-promotion on the user-visible `Blob.type` / `Response.json` header; keep charset inference internal (for text decoding only).
blast radius: medium - anything that started relying on the `;charset=utf-8` suffix would see it disappear, but that code is already non-portable.
confidence: high.

---

### `Bun.readableStreamTo*` family: 4/7 already deprecated, the remainder have Zalgo return types
what: Four of the seven `Bun.readableStreamTo*` helpers are `@deprecated` in favor of the (Bun-added) `ReadableStream.prototype.{bytes,blob,text,json}`; the three that remain declare sync-or-async union returns.
where: `/workspace/bun/packages/bun-types/deprecated.d.ts:44-84` (bytes/blob/text/json); `/workspace/bun/packages/bun-types/bun.d.ts:1778-1780` (`readableStreamToArrayBuffer(stream): Promise<ArrayBuffer> | ArrayBuffer`), `:1820` (`readableStreamToArray<T>(stream): Promise<T[]> | T[]`). Deprecation commit: `d4a52f77c7` "Move `ReadableStream#{text,bytes,json,blob}` to global (#20879)".
evidence: `@deprecated Use {@link ReadableStream.bytes}` etc. Closed issue #8843 "Bun.readableStreamToArrayBuffer() doesn't resolve to an ArrayBuffer when Bun.stdin.stream() is passed" - a real bug caused by the `Promise<T> | T` design (callers can't know whether to `await`).
why bad: The helpers duplicate `new Response(stream).arrayBuffer()` / `ReadableStream.prototype.*`. The surviving ones have the worst possible signature (a union of a value and a promise of that value). Deprecation is already half done; leaving 3 behind is inconsistent.
bun 2.0 proposal: Remove all seven `Bun.readableStreamTo*` from the `Bun` namespace. `readableStreamToFormData` is the only one without a one-liner equivalent; it can become `stream` + `new Response(stream, {headers:{"content-type": ...}}).formData()` or a `Bun.formData()` helper.
blast radius: medium - widely shown in old tutorials, but a codemod to the `ReadableStream` methods is mechanical.
confidence: high.

---

### `fetch()` silently fetches `file://` URLs (and `s3://`)
what: Bun's global `fetch` reads from the local filesystem for `file://` URLs, and from S3 for `s3://` URLs, where the web standard mandates a network error.
where: `/workspace/bun/packages/bun-types/globals.d.ts:1981-2005` (`s3?: Bun.S3Options`, `unix?: string`); `/workspace/bun/docs/runtime/networking/fetch.mdx:268-273` ("Protocol support: Beyond HTTP(S), Bun's fetch supports several additional protocols: S3 URLs - `s3://` ...").
evidence: Verified: `await fetch("file:///tmp/fetchtest.txt")` returns the file contents in Bun; Node throws `TypeError: fetch failed`. The WHATWG Fetch spec on `file:` URLs: "file and ftp URLs are left as an exercise for the reader. When in doubt, return a network error."
why bad: `fetch` is a security-sensitive, universally-named global. Code that passes a user-controlled string to `fetch()` (an extremely common pattern) in Bun becomes an arbitrary-file-read / cloud-credential-using primitive, which it is not in any browser or in Node. It's also a silent non-portability: SSR code tested in Bun breaks on deploy.
bun 2.0 proposal: Gate `file://`/`s3://` in `fetch` behind an explicit opt-in (`Bun.fetch` only, or `{allowFile: true}`), and route S3 through `Bun.S3Client`/`Bun.s3.file()` - both already exist.
blast radius: medium - `file://` fetch is undocumented enough that removal would be absorbed; `s3://` is documented but `Bun.s3.file()` is the 1:1 replacement.
confidence: high on the divergence; medium on whether the team would actually gate it.

---

### Non-standard overloads on `Request`/`Response` constructors and statics
what: Bun adds three overloads that no spec or other runtime has: `new Request({url, ...init})`, `Response.json(body, statusNumber)`, and `Response.redirect(url, ResponseInit)`.
where: `/workspace/bun/packages/bun-types/globals.d.ts:1849` (`new (requestInfo: RequestInit & { url: string })`), `:1880` (`json(body?, init?: ResponseInit | number)`), `:1896` (`redirect(url, init?: ResponseInit)`).
evidence: Verified: all three succeed in Bun and throw (`TypeError`/`RangeError`) in Node 26. The WHATWG spec signatures are `Request(input, init)`, `Response.json(data, init)`, `Response.redirect(url, status=302)`.
why bad: Each is a forward-compat landmine: the web platform could give `Response.json(x, 404)` or `new Request({url})` a *different* meaning later, and Bun would be incompatible in both directions. They also train users to write non-portable code against globals that look standard.
bun 2.0 proposal: Drop the object-as-first-arg `Request` overload and the bare-number `Response.json` second arg. `Response.redirect(url, init)` is genuinely useful - propose it upstream to WHATWG or move it to a `Bun.redirect()` helper instead of squatting on the standard static.
blast radius: low - each has a one-line standard-compliant rewrite.
confidence: high.

---

### Non-standard `Headers` additions, one already obsoleted by the standard
what: Bun adds `Headers.prototype.getAll()`, `toJSON()`, and `count` to the standard `Headers`; `getAll` is redundant with the now-standard `getSetCookie()` and its implementation contradicts its own docs.
where: `/workspace/bun/packages/bun-types/fetch.d.ts:35-70`.
evidence: `fetch.d.ts:55` docs say `getAll`: "Only `\"Set-Cookie\"` is supported. **Any other header name returns an empty array.**" Verified at runtime: `headers.getAll("X-Foo")` **throws** `Only "set-cookie" is supported.` - the documented behavior is wrong. `headers.getSetCookie()` (the WHATWG standard added for this exact need) returns the same thing. `toJSON()` is documented with "Does not preserve insertion order. Well-known header names are lowercased; other header names are left as-is." - an order- and case-lossy serialization bolted onto a standard class.
bun 2.0 proposal: Remove `getAll` (users have `getSetCookie()`); keep `toJSON`/`count` but consider `Object.fromEntries(headers)` / `[...headers].length` as the "standard enough" replacements and document the ordering caveat loudly.
blast radius: low - `getAll` is Set-Cookie-only and has a drop-in standard replacement.
confidence: high.

---

### `Bun.gc` / `Bun.shrink` / `Bun.generateHeapSnapshot` duplicate the entire `bun:jsc` module
what: GC/heap-introspection APIs are split with no principle between the `Bun` global and `bun:jsc`, and `Bun.shrink` is already deprecated.
where: `/workspace/bun/packages/bun-types/bun.d.ts:4765` (`Bun.gc`), `:4834-4836` (`Bun.shrink` - "@deprecated"), `:4803-4829` (`Bun.generateHeapSnapshot` x3 overloads); `/workspace/bun/packages/bun-types/jsc.d.ts:7-12,203-229` (`gcAndSweep`, `fullGC`, `edenGC`, `heapSize`, `heapStats`, `memoryUsage`, `estimateShallowMemoryUsageOf`, `getProtectedObjects`). Plus `Bun.unsafe.gcAggressionLevel` and `Bun.unsafe.mimallocDump` at `bun.d.ts:4718-4723`.
evidence: `bun.d.ts:4834`: `@deprecated` on `Bun.shrink`. `jsc.d.ts:3`: "Renamed from \"describe\" to avoid confusion with the test runner." - a prior rename for the same cluttered-namespace reason. `Bun.gc(true)`/`Bun.gc(false)` are functionally `jsc.fullGC()`/`jsc.gcAndSweep()`.
why bad: Two places for the same concept; users who find `Bun.gc` never find `heapStats()`. `Bun.shrink` is dead weight already.
bun 2.0 proposal: Move `gc` / `generateHeapSnapshot` into `bun:jsc` (or a `Bun.jsc` namespace) and delete `Bun.shrink`.
blast radius: low for `shrink` (deprecated, undocumented); medium for `Bun.gc` (widely used in tests) - keep a `Bun.gc` alias if needed.
confidence: high.

---

### The compression family is internally inconsistent and duplicates `node:zlib`
what: `Bun.gzipSync`/`deflateSync`/`inflateSync`/`gunzipSync` return `Uint8Array` and have no async twin; `Bun.zstdCompressSync`/`zstdDecompressSync` return `Buffer` *and* have async twins; there is no `Bun.brotli*` at all. `node:zlib` in Bun already provides all of them uniformly.
where: `/workspace/bun/packages/bun-types/bun.d.ts:5260-5327`.
evidence: Verified at runtime: `Bun.gzipSync("x").constructor.name === "Uint8Array"`, `Bun.zstdCompressSync("x").constructor.name === "Buffer"`, `typeof Bun.gzip === "undefined"`, `typeof Bun.brotliCompressSync === "undefined"`, `typeof Bun.zstdCompress === "function"`.
why bad: Three inconsistencies in one family (return type, async availability, algorithm coverage) is a textbook grab-bag-growth pattern. Every one of the eight functions has a `node:zlib` equivalent with a consistent API.
bun 2.0 proposal: Deprecate the `Bun.*` compression functions in favor of `node:zlib` (which Bun owns and can make just as fast), or normalize: every algorithm gets `{algo}Sync` + `{algo}` returning `Uint8Array`.
blast radius: medium - `Bun.gzipSync` shows up in tutorials, but a codemod to `zlib.gzipSync` is trivial and behaviorally identical.
confidence: high.

---

### `import.meta` has two names for every fact, plus two admittedly-unstable members
what: Bun invented `import.meta.path`/`dir`/`file` before Node standardized `filename`/`dirname`; now both sets exist. `import.meta.resolveSync` is deprecated and `import.meta.require` is documented as unstable.
where: `/workspace/bun/packages/bun-types/globals.d.ts:1299-1363`.
evidence: `globals.d.ts:1359`: "Alias of `import.meta.dir`. Exists for Node.js compatibility"; `:1362`: "Alias of `import.meta.path`. Exists for Node.js compatibility". `:1326`: `@deprecated` on `resolveSync`. `:1335-1336` on `require`: "Warning: **This API is not stable** and may change or be removed in the future." Verified at runtime that `import.meta.path === import.meta.filename` and `import.meta.dir === import.meta.dirname`.
why bad: `import.meta` is an ES language construct; putting five Bun-only properties on it was a bet that didn't pay off once Node standardized the names. Two names for each fact forever is pure maintenance debt, and the "Node compatibility" comments invert the real history (the *Node* names are the standard ones).
bun 2.0 proposal: Keep `filename`/`dirname` (Node-standard), drop `path`/`dir`/`file` and `resolveSync`. Keep `import.meta.require` only as long as the CJS-in-ESM transpile needs it, and stop documenting it.
blast radius: medium - `import.meta.dir` is very common in Bun code; ship a transpiler codemod.
confidence: high.

---

### Dozens of `Bun.*` functions are 1:1 duplicates of Node/stdlib, by their own docs
what: A cluster of `Bun.*` utilities exists purely because `node:*` wasn't compatible yet in Bun 0.x; each now has an identical (or strictly more capable) standard equivalent.
where/evidence (all verified at runtime):
  - `Bun.fileURLToPath` / `Bun.pathToFileURL` (`/workspace/bun/packages/bun-types/bun.d.ts:1858,1886`) - produce byte-identical output to `node:url`'s, but without Node's `{windows}` option.
  - `Bun.concatArrayBuffers` (`bun.d.ts:1751-1766`) - the JSDoc itself says "If you want a `Uint8Array` instead, consider `Buffer.concat`." Its 3rd arg is a positional boolean (`asUint8Array`) that only becomes reachable after you pass the unrelated `maxLength`.
  - `Bun.allocUnsafe` (`bun.d.ts:4175`) vs `Buffer.allocUnsafe`.
  - `Bun.inspect` (`bun.d.ts:4491-4496`) vs `util.inspect` - `Bun.inspect.custom === util.inspect.custom` (verified identical symbol).
  - `Bun.isMainThread` - verified `=== require("node:worker_threads").isMainThread`.
  - `Bun.version` - verified `=== process.versions.bun`.
  - `Bun.fetch` (`bun.d.ts:4846`) - typed as `typeof globalThis.fetch` yet verified `Bun.fetch !== globalThis.fetch` (a second, separate function object).
  - `Bun.nanoseconds()` (`bun.d.ts:4788-4797`) vs `process.hrtime.bigint()` - the JSDoc admits the design flaw: "JavaScript numbers are IEEE 754 doubles ... **After about 14.8 weeks of uptime the nanosecond count exceeds that, so the returned value keeps counting but loses precision.**"
why bad: Each is a second name for a thing with a first name that works in Bun. `Bun.nanoseconds` is the worst: it chose `number` over `bigint` for a 64-bit counter and the types now document the data loss rather than fixing it.
bun 2.0 proposal: Deprecate the pure duplicates (`fileURLToPath`, `pathToFileURL`, `allocUnsafe`, `concatArrayBuffers`) and point at the Node/stdlib equivalent. Change `Bun.nanoseconds()` to return `bigint` or delete it in favor of `process.hrtime.bigint()`.
blast radius: low–medium per item; they're leaf utilities with mechanical replacements.
confidence: high.

---

### `console` is an async-iterable over *stdin*, plus a non-standard `console.write`
what: Bun makes the global `console` object `for await`-able, yielding lines read from **standard input**, and adds `console.write()`.
where: `/workspace/bun/packages/bun-types/globals.d.ts:1141-1169`.
evidence: `globals.d.ts:1142-1151`: "Asynchronously read lines from standard input (fd 0) ... `for await (const line of console)`". Verified `typeof console[Symbol.asyncIterator] === "function"`. Open issue #7541: "Calling `next` on `console`'s asyncIterable causes its stream to become locked." Closed issue #9157: "For await console loop causes core dump ... on systemd service."
why bad: `console` is an *output* API in every other runtime and in the WHATWG Console spec. Putting stdin input on it is a category error that real users hit as lock/crash bugs. `console.write` duplicates `process.stdout.write` and `Bun.stdout.writer()`.
bun 2.0 proposal: Remove `console[Symbol.asyncIterator]` (the idiomatic replacement is `for await (const line of Bun.stdin.stream().pipeThrough(new TextDecoderStream()))` or the existing `node:readline`); remove or keep `console.write` as a documented Bun extension.
blast radius: low - both are niche; the stdin iterator already has open bugs.
confidence: high.

---

### `Bun.stdin/stdout/stderr` are `Blob`s with `size === Infinity`
what: stdio is modeled as `BunFile extends Blob`, which gives stdout a `.size`, `.type`, `.slice()`, `.json()`, and `.formData()` - and its `size` is `Infinity`, which the File API forbids.
where: `/workspace/bun/packages/bun-types/bun.d.ts:4542-4554`; `/workspace/bun/packages/bun-types/bun.d.ts:2100` (`interface BunFile extends Blob`).
evidence: Verified at runtime: `Bun.stdout instanceof Blob === true`, `Bun.stdout.size === Infinity`, `Bun.stdout.type === "application/octet-stream"`, `typeof Bun.stdin.json === "function"`. The File API spec types `Blob.size` as `unsigned long long` (a non-negative integer).
why bad: A stream pretending to be a `Blob` produces a spec-violating `Blob` and exposes a dozen nonsensical methods. It also makes `instanceof Blob` / structured-clone / `new Response(blob)` behave surprisingly on stdio.
bun 2.0 proposal: Give stdio a narrower type (a `ReadableStream`/writer pair) that does not extend `Blob`; keep `Bun.file(path)` as a `Blob` for regular files.
blast radius: medium - `Bun.stdout.writer()` is an established pattern and can be kept on the new type.
confidence: high on the spec violation; medium on the remodel.

---

### `ReadableStream` `type: "direct"` - a whole non-standard streams mode on a standard constructor
what: Bun adds a third `ReadableStream` underlying-source `type` (`"direct"`, beyond the standard `undefined`/`"bytes"`) whose controller has `write()`/`end()`/`flush()` with sync-or-async union return types and a negative-return backpressure protocol.
where: `/workspace/bun/packages/bun-types/bun.d.ts:310-314` (`DirectUnderlyingSource { type: "direct" }`); `/workspace/bun/packages/bun-types/globals.d.ts:78` (the extra constructor overload) and `:709-729` (`write(...): number | Promise<number>`, "returns a **negative number**" for backpressure).
evidence: Verified: `new ReadableStream({type:"direct", pull(c){c.write("hi");c.end()}})` produces a working stream. Note `bun.d.ts:304-307` says `UnderlyingSource.type?: undefined` with comment "Mode \"bytes\" is not supported." - which is **stale**: BYOB streams now work (`rs.getReader({mode:"byob"})` verified), so the types are actively wrong.
why bad: WHATWG is free to add a new `type` value; Bun already squats on that extension point. The `number | Promise<number>` controller return and "negative means slow down" protocol are unique to Bun and cannot be polyfilled. Code using `"direct"` is 100% non-portable.
bun 2.0 proposal: Rename to a clearly-Bun constructor (`new Bun.DirectStream(...)` / `Bun.ArrayBufferSink`-style), or at minimum move the overload off the global `ReadableStream` constructor. Independently, fix the stale `type?: undefined` annotation.
blast radius: medium - `type: "direct"` is the documented fast path for `Bun.serve` responses.
confidence: high on the non-standardness; medium on the rename.

---

### Three ways to hash the same bytes, with misleading names and a nonsensical encoding set
what: `Bun.sha` (whose name says "SHA" but whose algorithm is SHA-512/256), seven standalone hash classes (`Bun.SHA1`, `Bun.MD4`, `Bun.MD5`, `Bun.SHA224/256/384/512`, `Bun.SHA512_256`), `Bun.CryptoHasher`, and `node:crypto.createHash` all coexist; and `DigestEncoding` accepts character encodings that corrupt hash bytes.
where: `/workspace/bun/packages/bun-types/bun.d.ts:5078-5099` (`Bun.sha` - "Hash `input` using [SHA-2 **512/256**]"), `:5106-5165` (the seven classes; `SHA1`'s own doc says "This is not the default because it's not cryptographically secure"), `:4740` (`type DigestEncoding = "utf8" | "ucs2" | "utf16le" | "latin1" | "ascii" | "base64" | "base64url" | "hex"`).
evidence: Verified: `Bun.sha("hello","utf8")` returns mojibake (the raw SHA bytes reinterpreted as a character encoding - silently corrupted), while `"hex"` returns the correct digest. Node's `Hash.digest` encoding type is `"base64" | "base64url" | "hex" | "binary"` only, for exactly this reason. `Bun.MD4` exposes a fully broken hash on the main namespace.
why bad: `Bun.sha(x)` computing SHA-512/256 is a trap - no other API named `sha` does that. The 5 text encodings in `DigestEncoding` are a silent-corruption footgun. Three parallel hashing APIs is the grab-bag problem in miniature, and shipping `Bun.MD4` on the global encourages its use.
bun 2.0 proposal: Remove the standalone classes and `Bun.sha`; `Bun.CryptoHasher` (+ `node:crypto`) covers everything. Narrow `DigestEncoding` to `"hex" | "base64" | "base64url"`.
blast radius: low - `Bun.CryptoHasher("sha512-256")` is a drop-in; the classes are rarely used.
confidence: high.

---

### `Bun.deepEquals` / `Bun.deepMatch`: loose default, positional boolean, inverted argument order
what: `Bun.deepEquals(a, b, strict = false)` defaults to Jest's *loose* `toEqual` semantics, and `Bun.deepMatch(subset, object)` puts the subset first - opposite of the `expect(object).toMatchObject(subset)` it claims to power.
where: `/workspace/bun/packages/bun-types/bun.d.ts:2333-2346`.
evidence: `bun.d.ts:2336`: `/** @default false */ strict?: boolean`. Verified: `Bun.deepEquals({a:undefined},{}) === true` but `Bun.deepEquals({a:undefined},{},true) === false`. `bun.d.ts:2344`: "This also powers expect().toMatchObject" - but the subset is the *first* arg to `deepMatch` and the *argument* (not receiver) to `toMatchObject`. Node's `util.isDeepStrictEqual` already exists with the strict semantics.
why bad: A function named `deepEquals` whose unflagged behavior is "treats `{a:undefined}` as equal to `{}`" surprises everyone who isn't thinking about Jest. A positional boolean third arg is the exact pattern Bun's own review guidelines flag.
bun 2.0 proposal: Default `strict` to `true`, or rename the loose form `Bun.jestEquals`. Swap `deepMatch` to `(object, subset)` or take an options object.
blast radius: low–medium - a default flip is a genuine behavior change, so this is precisely a 2.0 item.
confidence: high on the facts; medium on which fix they'd pick.

---

### `Bun.color(input, format)` is a stringly-typed output-shape DSL
what: The second argument to `Bun.color` selects the *return type* by encoding punctuation and case inside a string literal: `"rgb"` → CSS string, `"[rgb]"` → array, `"{rgb}"` → object, `"number"` → int, `"hex"` vs `"HEX"` → lowercase vs uppercase hex.
where: `/workspace/bun/packages/bun-types/bun.d.ts:4583-4665`.
evidence: `bun.d.ts:4641`: `function color(input, outputFormat: "[rgb]"): [number, number, number] | null;` `:4653`: `outputFormat: "{rgb}"`. `:4606-4611`: `"hex"` and `"HEX"` as two separate enum members differing only in case.
why bad: `"[rgb]"` vs `"{rgb}"` vs `"rgb"` is punctuation-as-type-selector; `"hex"`/`"HEX"` is two accepted spellings differing in case. The function's return type is a 6-way union picked by a magic string, and it returns `null` on parse failure instead of throwing (error-swallowing by design).
bun 2.0 proposal: One format string for the *color space* and a separate `{format: "array" | "object" | "string" | "number"}` option (or separate functions `Bun.color.rgb()`, `.hex()`).
blast radius: low - `Bun.color` is new (1.1.x) and not load-bearing.
confidence: medium (it's a working API; this is a taste call backed by the unusual string literals).

---

### Import attributes: 20+ non-standard `type:` values on a key the web owns
what: Bun accepts `with { type: X }` for 22 loader names - `toml`, `yaml`, `json5`, `jsonc`, `text`, `file`, `sqlite`, `sqlite_embedded`, `sh`, `html`, `md`, `markdown`, `base64`, `dataurl`, `napi`, ... - on the same `type` key TC39/HTML reserve (currently standardizing only `"json"`/`"css"`, with `"bytes"`/`"text"` proposals in flight).
where: `/workspace/bun/src/ast/loader.rs:30-53` (the full enum) and `:147-153`; `/workspace/bun/docs/runtime/file-types.mdx:12-17`, `/workspace/bun/docs/bundler/loaders.mdx:274-290` (`with { type: "sqlite", embed: "true" }` - a *string* `"true"`).
evidence: `loader.rs:174`: `// TODO: loader for reading bytes and creating module or instance` - i.e. Bun knows a `bytes` loader is coming and TC39 has a Stage-2 `type: "bytes"` proposal that could collide. `type: "file"` returns a *path string*, a semantic no other runtime has; `type: "sqlite"` returns a `Database`.
why bad: Every value Bun claims on `type:` is a value TC39 can never standardize for the web without breaking Bun (or vice versa). `text` and `bytes` are the two most likely to be standardized with *compatible* semantics, but `file`, `sqlite`, `sh`, `markdown` are not. `embed: "true"` as a string boolean is a parser constraint leaking into UX.
bun 2.0 proposal: Move Bun-only loaders to a Bun-prefixed attribute key (e.g. `with { loader: "sqlite" }` or `with { bunType: "file" }`) and keep `type:` for values that match (or will match) the standard.
blast radius: medium - these are in tutorials, but the attribute is a transpile-time rewrite so a deprecation period is cheap.
confidence: medium-high.

---

### `fetch` `protocol` option: four spellings for two values; `verbose` admits it may be removed
what: `BunFetchRequestInit.protocol` accepts `"http2" | "http1.1" | "h2" | "h1"` (four spellings, two meanings); `verbose` accepts `boolean | "curl"` and its own docs say it may be removed.
where: `/workspace/bun/packages/bun-types/globals.d.ts:2018` and `:1930-1935`.
evidence: `globals.d.ts:2018`: `protocol?: "http2" | "http1.1" | "h2" | "h1";`. `:1931-1933` on `verbose`: "Log the raw HTTP request and response to stdout, as a debugging aid. **This API may be removed in a future version of Bun without notice.**" The parser at `/workspace/bun/src/runtime/webcore/fetch.rs:944` handles `verbose: boolean | "curl" | undefined`.
why bad: "Every accepted spelling of an option" is a footgun the repo's own review guidelines call out. An option whose docs say it may be removed without notice is a pre-announced breaking change.
bun 2.0 proposal: Pick one spelling (`"h2" | "h1"` or `"http/2" | "http/1.1"`). Remove `verbose` from the `fetch` signature and make it an env var / `Bun.fetch`-only debug knob, as the doc already threatens.
blast radius: low.
confidence: high.

---

### Hidden and dead `Bun.*` members: `cwd`, `origin`, `postgres`, `FetchEvent`
what: `Bun.cwd` and `Bun.origin` exist at runtime but are `DontEnum` and absent from `bun-types`; `Bun.postgres` is a second name for `Bun.sql`; `FetchEvent` survives only as a type for an API that was removed.
where: `/workspace/bun/src/jsc/bindings/BunObject.cpp:952` (`cwd ... DontEnum|DontDelete`), `:981` (`origin ... DontEnum`), `:1032-1033` (`sql` and `postgres` both map to `defaultBunSQLObject`); `/workspace/bun/packages/bun-types/bun.d.ts:175-188` (`interface FetchEvent extends Event { respondWith ... }` and `interface EventMap { fetch: FetchEvent }`).
evidence: Verified at runtime: `Bun.cwd === "/workspace/bun"` (a string, duplicating `process.cwd()`), `Bun.origin === ""`, `Bun.postgres === Bun.sql`, and `typeof globalThis.FetchEvent === "undefined"` - the `FetchEvent`/`respondWith` service-worker-style API (from Bun 0.1's pre-`Bun.serve` server) is gone but its types remain.
why bad: Hidden-but-present properties are undeletable API surface with no docs. `FetchEvent` types describe something that does not exist. `postgres` as an alias of `sql` is a naming fork baked in before MySQL/SQLite support made it wrong.
bun 2.0 proposal: Delete `Bun.cwd`, `Bun.origin`, the `FetchEvent`/`EventMap` types, and `Bun.postgres` (keep `Bun.sql`).
blast radius: low - all undocumented or dead.
confidence: high.

---

### Type-surface aliases kept only for an older Bun
what: `bun-types` ships a `deprecated.d.ts` of names that exist solely for backward compatibility with Bun 0.x naming; 2.0 is the moment to delete them.
where: `/workspace/bun/packages/bun-types/deprecated.d.ts:119-184`.
evidence: Verbatim: `:119` "@deprecated Renamed to \`ErrorLike\`" (`Errorlike`); `:177` "@deprecated Renamed to \`BuildMessage\`" (`BuildError`); `:182` "@deprecated Renamed to \`ResolveMessage\`" (`ResolveError`); `:132/141/148` `TLSOptions.keyFile/certFile/caFile` "@deprecated since **v0.6.3** - Use `key: Bun.file(path)` instead"; `:102-116` `ServeOptions`/`SQLQuery`/`SQLOptions`/… type aliases.
why bad: These are literal "renamed to X" records. `keyFile/certFile/caFile` have been deprecated since v0.6.3 (two years) and are a casing/shape footgun alongside the real `key/cert/ca`.
bun 2.0 proposal: Delete `deprecated.d.ts` and the corresponding runtime acceptance of `keyFile`/`certFile`/`caFile`.
blast radius: low - all already marked deprecated.
confidence: high.

---

## Honorable mentions (smaller / lower confidence, noted for completeness)

- **`Bun.file(n: number)` means "file descriptor"** (`/workspace/bun/packages/bun-types/bun.d.ts:4168`) and **`Bun.file(Uint8Array)` means "a path encoded as bytes"** (`bun.d.ts:4152`) - in every other Bun API a `Uint8Array` is *data*. Both are surprising positional-type dispatch.
- **`Bun.hash(data, seed?)` is typed `=> number | bigint`** (`bun.d.ts:2305-2308`) though verified it always returns `bigint` today - the union is a relic of the pre-bigint design; the sub-algorithm return types (`crc32 → number`, `wyhash → bigint`) are correct but the top-level type should be narrowed. Related fix commit: `9a5d6386dd` "hash: use the full 64-bit seed in Bun.hash.xxHash3".
- **`Bun.plugin` JSDoc is stale** (`bun.d.ts:5692-5696`): "A future version of Bun may also support specifying plugins in `bunfig.toml`." - `preload` in `bunfig.toml` has existed for years. `Bun.plugin()` (global register-one) vs `Bun.build({plugins: []})` (array) is also two shapes for one concept.
- **Commented-out duplicate `stringWidth` declaration** left in the types (`bun.d.ts:7960-7971`) - dead code in the shipped `.d.ts`.
- **`UnderlyingSource.type?: undefined` with "Mode \"bytes\" is not supported."** (`bun.d.ts:304-307`) is stale: BYOB readers work (verified `rs.getReader({mode:"byob"})`). A stale spec-conformance *denial* in the public types.
- **`fetch.preconnect()`** (`globals.d.ts:2110`) - a static method hung off the standard global `fetch` function. Harmless but another squat on a global extension point.
- **`Bun.openInEditor`, `Bun.mmap`, `Bun.indexOfLine`, `Bun.unsafe.arrayBufferToString`** - a dev-tooling command, a raw memory map, a newline scanner, and a crash-if-misused string cast (`bun.d.ts:4687`: "your application may crash or hit confusing bugs such as `\"foo\" !== \"foo\"`") all living on the same flat namespace as `Bun.serve`. No individual is wrong; together they're the grab-bag. A `bun:unsafe` / `bun:dev` module split is the 2.0-shaped answer.

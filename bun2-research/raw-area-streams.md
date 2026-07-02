# Bun 2.0 candidates - Bun-specific stream APIs

All file:line references are in the `/workspace/bun` checkout. Runtime behavior was verified on Bun `1.4.0-canary.1+d816daf47`.

### `Bun.readableStreamTo*()` family: half-deprecated, docs contradict types, replaced by another non-standard API

what: Seven `Bun.readableStreamTo{Text,JSON,Blob,Bytes,ArrayBuffer,Array,FormData}` functions duplicate `Response.prototype.*`/`Array.fromAsync`; 4 of 7 are `@deprecated` but the other 3 are not, the docs still teach all 7 undeprecated, and the recommended replacement doesn't typecheck.
where: `packages/bun-types/deprecated.d.ts:34-86` (the 4 deprecated ones), `packages/bun-types/bun.d.ts:1778`, `:1809`, `:1820` (the 3 not deprecated), `docs/runtime/utils.mdx` ("## `Bun.readableStreamTo*()`" lists all 7 with no deprecation note), `docs/guides/streams/to-string.mdx` (teaches `Bun.readableStreamToText`), `docs/guides/streams/to-json.mdx` (teaches `stream.json()` - different answer for the same task), `src/js/builtins/ReadableStream.ts:110-344`.
evidence:
  - `deprecated.d.ts`: `@deprecated Use {@link ReadableStream.bytes}` / `.blob` / `.text` / `.json` on `readableStreamToBytes/Blob/Text/JSON`. `readableStreamToArrayBuffer`, `readableStreamToFormData`, `readableStreamToArray` have NO `@deprecated` (`bun.d.ts:1778-1820`).
  - Issue #29401 (open): "ReadableStream is deprecated but proposed replacement doesn't exist." - `Bun.readableStreamToText` is flagged deprecated, but `stream.text()` is `error TS2339` when `lib.dom` is loaded. The cause is deliberate: PR #20879 ("Move `ReadableStream#{text,bytes,json,blob}` to global") says "This change does not load them when `DOM` is loaded", and the augmentation is `declare module "stream/web"` (`packages/bun-types/overrides.d.ts:28-35`), which never reaches the global `ReadableStream`.
  - Return types lie: `readableStreamToArrayBuffer(): Promise<ArrayBuffer> | ArrayBuffer` and `readableStreamToArray<T>(): Promise<T[]> | T[]` (`bun.d.ts:1780`, `:1820`), but the implementation *always* returns a Promise (`ReadableStream.ts:218` `return $createFulfilledPromise(...)`). Verified: `Bun.readableStreamToArrayBuffer(new Response("x").body)?.constructor?.name === "Promise"`.
  - Issue #9132 (closed): "Add `instanceof ReadableStream` check to `Bun.readableStreamTo*` methods" - the family needed its own arg validation the standard path gets for free.
why bad: Two Bun-specific APIs now exist for the same job (`Bun.readableStreamToText(s)` and `s.text()`), both non-standard, and the portable answers (`new Response(s).text()`, `Array.fromAsync(s)`, `Response.bytes()`) already work everywhere. The `Promise<T>|T` declared return type trains users to write branching code that is dead.
bun 2.0 proposal: Delete all seven `Bun.readableStreamTo*` functions. Point users at `new Response(stream).text()/json()/bytes()/arrayBuffer()/blob()/formData()` and `Array.fromAsync(stream)`. If `ReadableStream.prototype.{text,json,bytes,blob}` stays, ship it as the `@types` default too (fix #29401) and commit to removing it if the WHATWG proposal lands differently.
blast radius: high - `readableStreamToText` is in the top tier of Bun-API usage and the docs have taught it since 0.x.
confidence: high.

### `ReadableStream({ type: "direct" })`: a second, consumer-polymorphic stream protocol with in-band backpressure sentinels

what: The non-standard `type: "direct"` constructor overload hands `pull()` a bare-object "controller" whose identity, method set, and even `write()` return value depend on which function *consumes* the stream, and which signals backpressure by returning a negative number.
where: `packages/bun-types/bun.d.ts:300-314` (`DirectUnderlyingSource`), `packages/bun-types/globals.d.ts:698-731` (`ReadableStreamDirectController`), `src/js/builtins/ReadableStreamInternals.ts:1516-1636` (`initializeTextStream`/`initializeArrayStream`/`initializeArrayBufferStream` each install a *different* controller object), `src/runtime/webcore/streams.rs:383-402`, `:566`, `docs/runtime/streams.mdx:43-95`.
evidence:
  - In-source spec-divergence admission, `ReadableStreamInternals.ts:1176`: `// Direct streams allow $pull to be called multiple times, unlike the spec.`
  - `write()` return value is destination-dependent. Verified: `controller.write("héllo")` returns **5** (UTF-16 length) when the same stream is consumed by `Bun.readableStreamToText`/`toArray`/`Response#text`, but **6** (UTF-8 bytes) when consumed by `Bun.readableStreamToArrayBuffer`. The types/docs say it "Returns the number of bytes written" (`globals.d.ts:700-719`).
  - In-band error channel: `streams.rs:390-396` - "`to_js()` reports `-(len + 1)` so the JS write loop can detect backpressure without conflating it with `Pending` (FileSink on Windows returns a Promise on every write…)"; `streams.rs:566`: `Writable::Backpressure(len) => JSValue::js_number(-((len as f64) + 1.0))`. The negative sentinel exists *because* `FileSink.write()` already has a platform-dependent return type. `docs/runtime/streams.mdx:75`: "it returns a **negative number** instead. The chunk is still accepted".
  - Verified: `controller.close === controller.end` is `true` (they are the same function, `$onCloseDirectStream`) on the text/array/default sinks but `false` on the `readableStreamToArrayBufferDirect` sink - so the two "different" methods are aliases on some paths and distinct on others.
  - The runtime invokes an `underlyingSource.close(reason)` callback (`ReadableStreamInternals.ts:1131`, `:1297`) that is **not declared** in `DirectUnderlyingSource` (`bun.d.ts:310-314` declares only `cancel`/`pull`/`type`). Verified it fires.
  - The original perf justification is gone: since PR #32553, `docs/runtime/streams.mdx:95` says "For default (non-`direct`) `ReadableStream`s and async-generator response bodies, Bun applies this backpressure automatically".
  - User-visible fallout: #11232 (open), #10632, #8404 `TypeError: Expected Sink code: "ERR_INVALID_THIS"`; #13811 (SSE via direct streams broke across minor releases); #31887 (open, UAF with `type:"direct"` stdin).
  - The types actively steer users away from the *standard* alternative: `bun.d.ts:304-307` declares `UnderlyingSource.type?: undefined` with the JSDoc `Mode "bytes" is not supported.` - **false**. Verified: `new ReadableStream({type:"bytes",...}).getReader({mode:"byob"})` works in Bun 1.4.
why bad: It is an entire second stream protocol grafted onto the WHATWG constructor. The one thing it still offers over a byte stream (writing straight into the destination's buffer) is an implementation detail that could be a fast path *behind* the standard controller. Meanwhile the sentinel encoding (`number | negative number | Promise | true`) is exactly the kind of in-band signaling the WritableStream `.ready` promise was designed to replace.
bun 2.0 proposal: Remove `type: "direct"` from the public `ReadableStream` constructor. Keep the zero-copy path as an internal optimization triggered by `type: "bytes"` / `byobRequest` (already implemented). Fix the `Mode "bytes" is not supported` type lie immediately regardless.
blast radius: high - Bun's own docs, the SSE ecosystem, and Astro/SSR code use `type: "direct"` heavily.
confidence: high.

### `BunFile.writer()` → `FileSink`: a bespoke writable that should have been a `WritableStream`

what: `Bun.file(x).writer()` returns a `FileSink` (`write`/`flush`/`end`/`start`/`ref`/`unref`), an ad-hoc interface that is not a `WritableStream`, can't be `pipeTo()`'d, has no backpressure signal, a platform-dependent return type, and a non-obvious no-truncate default - and the types contain a `TODO` for the standard replacement.
where: `packages/bun-types/bun.d.ts:2136-2140`, `packages/bun-types/s3.d.ts:7-99` (`FileSink`/`NetworkSink` are declared in the *S3* types file), `src/runtime/webcore/FileSink.rs`, `src/codegen/generate-jssink.ts:3-22`.
evidence:
  - Verbatim, `packages/bun-types/bun.d.ts:2138-2140`:
    ```ts
    // TODO
    // readonly readable: ReadableStream<Uint8Array>;
    // readonly writable: WritableStream<Uint8Array>;
    ```
    and PR #20879's description: "This also removes BunFile.readable - it doesn't exist" (the property was declared in types but never implemented).
  - Issue #12194 (open), "FileSink.write incoherencies": "I'd not expect `FileSink.write` to randomly return a promise … I'd definitely not expect `FileSink.write` to return a number greater than the size of the buffer I passed to it." The types admit it: `write(...): number | Promise<number>` (`s3.d.ts:16`). PR #32553 documents the why: "FileSink writes - which return a `Promise` on every call on Windows pipes".
  - Issue #29341 (closed): robobun triage confirms "`FileSink` … does not currently expose backpressure signals equivalent to Node's `Writable`. The current surface is only `write`, `flush`, `end`, `start`, `ref`, `unref`."
  - Issue #25968 (open): "`FileSink` does not truncate existing file" - `file.writer()` opens without `O_TRUNC`, so rewriting a shorter payload leaves trailing bytes of the old file (`"Short"` → `"Shortcontent"`). `Bun.write()` and Node's `fs.createWriteStream` (default `flags:'w'`) both truncate.
  - The codegen machinery for a proper `WritableStream` wrapper already exists but is unused: `src/codegen/generate-jssink.ts:20-21` emits a `JSWritableStreamSource${name}` class per sink.
why bad: The web and Node (`Writable.toWeb`) both converged on `WritableStream` for this job; Deno ships `FsFile.readable`/`.writable`. `FileSink` is incompatible with `readable.pipeTo(...)`, the single most important composition primitive in the streams model, and its `start()` method exists only because the same C++ object also implements the internal `UnderlyingSink` protocol.
bun 2.0 proposal: Ship `BunFile.readable: ReadableStream` and `BunFile.writable: WritableStream` (the commented-out design), make `file.writer()` return the `WritableStreamDefaultWriter` of that `writable` (so `.write()` returns the spec's `Promise<void>` and `.ready` carries backpressure), and make it truncate by default with an `{append}` opt-in. Retire `FileSink` as a public name.
blast radius: medium - `file.writer()` is documented and used, but the call sites are concentrated and mechanical to migrate.
confidence: high.

### `Bun.ArrayBufferSink`: explicit "this API might change" comment, a `flush()` that returns three different types, and a constructor that silently drops its options

what: `ArrayBufferSink.flush()` returns `number` OR `ArrayBuffer` OR `Uint8Array` depending on which options were passed to a *separate* `start()` call, the constructor takes no options, and the shipped JSDoc admits the API is wrong.
where: `packages/bun-types/bun.d.ts:1891-1918`, `docs/runtime/streams.mdx:222-256`, `src/runtime/webcore/ArrayBufferSink.rs`.
evidence:
  - Verbatim JSDoc in both the types (`bun.d.ts:1914`) and the docs (`docs/runtime/streams.mdx:251`): "This API might change later to separate Uint8ArraySink and ArrayBufferSink."
  - Verified at runtime: `flush()` → `0` by default, `ArrayBuffer` with `start({stream:true})`, `Uint8Array` with `start({stream:true,asUint8Array:true})`. `end()` → `ArrayBuffer | Uint8Array`, also set by `start()`.
  - Issue #2068 (open), "Improve `ArrayBufferSink` constructor": asks for `new Bun.ArrayBufferSink({stream:true, highWaterMark:1024})`. Verified worse-than-ignored today: `new Bun.ArrayBufferSink({stream:true, asUint8Array:true})` **silently discards** the object - `end()` still returns `ArrayBuffer`. A typo'd or constructor-passed option is an undetectable no-op.
  - The mandatory two-step `new X(); x.start(opts)` is the internal `UnderlyingSink` protocol leaking into the public API (`generate-jssink.ts`).
why bad: Return-type-decided-by-earlier-method-call is the hardest kind of API to type and the easiest to misuse. The team wrote "this API might change later" in 2022 and shipped it verbatim ever since.
bun 2.0 proposal: `new Bun.ArrayBufferSink(options?)` (options in the constructor, `start()` removed or made a no-op alias); `end()` always returns `Uint8Array`; `flush()` always returns `Uint8Array` - or throws in non-`stream` mode. Consider whether the class is needed at all now that `Uint8Array`/`Blob`/resizable `ArrayBuffer` cover the use case.
blast radius: low/medium - used internally and in SSR fast paths, but the surface is small and mechanical.
confidence: high.

### Bun added non-standard `ReadableStream.prototype.{text,json,bytes,blob}` but never shipped the *standard* `ReadableStream.from()`

what: Bun extends the `ReadableStream` prototype with four consumer methods that exist in no spec and no other runtime, while leaving out `ReadableStream.from()`, which *is* in the WHATWG Streams Standard and shipped in Node ≥20.6, Deno, and Firefox.
where: `src/jsc/bindings/webcore/JSReadableStream.cpp:166-178` (HashTable adds `blob`, `bytes`, `json`, `text`), `packages/bun-types/overrides.d.ts:28-35`.
evidence:
  - Verified: `typeof ReadableStream.prototype.text/json/bytes/blob === "function"`, `typeof ReadableStream.from === "undefined"` on Bun 1.4.
  - Issue #3700 (open, 9 comments): "Support `ReadableStream.from()` … The Streams standard now has a new utility method". Issue #32529 (open): "`ReadableStream` from `node:stream/web` does not implement method `from`".
  - The only way today to make a stream from an iterable in Bun is the non-standard `new Response(asyncIterable)` body overload (`ReadableStreamInternals.ts:1970`), which internally creates a `type:"direct"` stream and pipes the *direct controller* back through `iter.next(controller)` (`ReadableStreamInternals.ts:1989`) so that `yield` "returns the controller" (`docs/runtime/streams.mdx:127-138`) - a contract that exists nowhere else.
why bad: It is exactly backwards from "match the platform": Bun invented a prototype extension the spec doesn't have and skipped the static the spec does have. `declare module "stream/web"` is also why the extension fails to typecheck on the global object (#29401).
bun 2.0 proposal: Ship `ReadableStream.from()`. Make `.text()/.json()/.bytes()/.blob()` conditional on the WHATWG proposal actually landing (they were added 2025-07 in PR #20879); if it doesn't, remove them and keep `new Response(s).*` as the answer. Drop the `yield`-returns-controller contract.
blast radius: low for adding `from()`; medium for removing the prototype methods.
confidence: high.

### `Blob.stream()` / `Bun.stdin.stream()`: a hidden caching behavior and a non-standard argument that both violate the File API

what: For file-descriptor-backed `BunFile`s, `.stream()` returns the *same cached* `ReadableStream` on every call (the File API mandates a new stream each call), and `.stream()` also accepts an undocumented, non-standard `chunkSize` number argument.
where: `src/runtime/webcore/Blob.rs:1209-1234`, `packages/bun-types/globals.d.ts:1512` (`stream(): ReadableStream` - the parameter isn't even declared), `docs/guides/process/stdin.mdx`.
evidence:
  - `Blob.rs:1225-1231` (verbatim comment): "in the case we have a file descriptor store, we want to de-duplicate readable streams. in every other case we want `.stream()` to be its own stream." Verified: `Bun.stdin.stream() === Bun.stdin.stream()` → `true`; `Bun.file(0).stream() === Bun.file(0).stream()` → `true`; `Bun.file("/etc/hostname").stream() === ...` → `false`; `new Blob(["x"]).stream() === ...` → `false`.
  - Issue #11712 (open): "Document `Bun.stdin.stream()` and `Bun.file(\"/dev/stdin\").stream()` are not the same, behave differently".
  - Issue #11711 (closed): "`Blob.stream()` per specification has no parameters" - cites https://w3c.github.io/FileAPI/#dom-blob-stream. Jarred-Sumner: "This is used by Bun.file to specify chunk sizes". jimmywarting: "if whatwg/fetch#1600 gets accepted … you have shot yourself in the foot." `Blob.rs:1209-1222` parses `callframe.argument(0)` as `recommended_chunk_size`.
  - Related open footguns: #8695 "`Bun.stdin.stream()` loses chunks in async iteration"; #8843 (closed) readableStreamToArrayBuffer + `Bun.stdin.stream()`.
why bad: Identity caching means the second consumer silently gets an already-locked stream - the opposite of what the spec, MDN, and every other runtime promise - and it depends on whether the `BunFile` was constructed from an fd or a path, which the user cannot tell from the call site.
bun 2.0 proposal: Remove the `chunkSize` argument (move it to `Bun.file(x, {chunkSize})` or drop it). Make `.stream()` always return a fresh stream; if fd-backed input can only be read once, surface that by erroring on the second read, not by aliasing objects.
blast radius: medium - `Bun.stdin.stream()` is the documented way to read stdin and anything depending on the aliasing is implicit.
confidence: high.

### `ReadableStreamDefaultReader.prototype.readMany()`: internal optimization leaked onto a standard interface

what: A non-standard `readMany()` on the standard `ReadableStreamDefaultReader` that returns `Promise<{done,size,value:T[]}> | {done,size,value:T[]}` - the same sync-or-async polymorphism as `Bun.peek` - and is used pervasively in Bun's own internals.
where: `packages/bun-types/globals.d.ts:740-744`, `src/js/builtins/ReadableStreamDefaultReader.ts:45`, used from `node/stream.consumers.ts`, `node/http.ts`, `internal/webstreams_adapters.ts:112`, `builtins/ConsoleObject.ts:58`.
evidence:
  - `globals.d.ts:741-743` JSDoc: "Only available in Bun. If there are multiple chunks in the queue, returns all of them at once. Returns a promise only if the data is not immediately available."
  - A user debugging issue #13696 (real-world testcontainers hang): "could `ReadableStreamDefaultReader.readMany` here be the culprit? … `readMany` is not part of the official `ReadableStreamDefaultReader` spec and is indeed documented as such."
  - The `size` field is documented as "Number of bytes" (`bun.d.ts:148`) on a reader that is generic over `T` - wrong for string/object streams.
why bad: It is purely an implementation detail of Bun's builtins that became public API by virtue of living on a spec-defined prototype. The `T | Promise<T>` shape is the documented anti-pattern the rest of the ecosystem avoids (and that Bun itself is walking back on `readableStreamTo*`).
bun 2.0 proposal: Rename to a private intrinsic (`$readMany`) and remove it from the public prototype and from `@types/bun`. There is no portable code that can call it.
blast radius: low - it's invisible enough that few users know it exists; Bun's internals keep the fast path.
confidence: high.

### `console[Symbol.asyncIterator]`: a third, non-standard way to read stdin, built on the cached stream

what: Bun makes the WHATWG `console` namespace object async-iterable (`for await (const line of console)`) as the *documented primary* way to read lines from stdin, alongside `process.stdin` and `Bun.stdin.stream()`.
where: `src/js/builtins/ConsoleObject.ts:1-110`, `packages/bun-types/overrides.d.ts:389-403` (`declare module "console" { interface Console { [Symbol.asyncIterator]... } }`), `docs/guides/process/stdin.mdx` (first example).
evidence:
  - The console spec (https://console.spec.whatwg.org/) defines no iteration protocol; no other runtime has this.
  - `ConsoleObject.ts:3`: `var stream = Bun.stdin.stream();` - each `[Symbol.asyncIterator]()` call grabs the *same cached* stream (see the `Blob.stream()` finding) and calls `getReader()` on it, so a second concurrent `for await` over `console` fights the first.
  - `ConsoleObject.ts:38`: `// TODO: "\r", 0x4048, 0x4049, ...` - line splitting is admitted-incomplete (`\n` only, plus a win32-only `\r\n` special case at line 44).
why bad: It overloads an unrelated standard global with I/O semantics, duplicates `node:readline`'s `for await (const line of rl)` (which Bun also supports), and inherits every bug of the cached-stdin-stream design. Three documented ways to read stdin is two too many.
bun 2.0 proposal: Remove `console[Symbol.asyncIterator]`. Document `node:readline`'s `createInterface({input: process.stdin})` + `for await`, or add a `Bun.stdin.lines()` that doesn't sit on `console`.
blast radius: low/medium - it is the *first* example in the stdin guide, so it's in tutorials, but the replacement is a two-line diff.
confidence: high.

### `HTMLRewriter.transform()`: return type depends on argument type, the types lie, and `ReadableStream` bodies fail

what: `transform()` returns `string` for `string`, `ArrayBuffer` for any `BufferSource`, and `Response` for `Response`; the declared overloads disagree with the runtime; and the stream case - the one HTMLRewriter exists for - throws.
where: `packages/bun-types/html-rewriter.d.ts:169-181`, `src/runtime/api/html_rewriter.rs:748-786`.
evidence (all verified on Bun 1.4):
  - `transform("<p>a</p>")` → `string`; `transform(arrayBuffer)` → `ArrayBuffer`; `transform(new Uint8Array(...))` → `ArrayBuffer` - but the declared overload is `transform(input: Response | Blob | Bun.BufferSource): Response` (`html-rewriter.d.ts:169`), so TypeScript reports `Response` for a `Uint8Array` input that actually returns an `ArrayBuffer`.
  - `transform(new Blob(["<p>a</p>"]))` → **throws** `TypeError: Expected Response or Body` even though the types accept `Blob`.
  - `transform(new Response(readableStream, {headers:{"content-type":"text/html"}}))` → **throws** `ERR_STREAM_CANNOT_PIPE: Failed to pipe stream` (issue #14216, open). `html_rewriter.rs:766`: `system_error("ERR_STREAM_CANNOT_PIPE", "Failed to pipe stream")`.
  - Cloudflare's `HTMLRewriter.transform()` (the API Bun copied) takes only `Response` and returns only `Response`.
why bad: The argument-typed return value is a footgun that TypeScript can't even model correctly today, and the one shape that makes HTMLRewriter "a streaming transformer" - a `Response` with a streaming body - is the one that throws.
bun 2.0 proposal: `transform(Response) -> Response` only (matching Cloudflare), plus a separate `transformText(string) -> string` if the sync convenience is wanted. Make JS `ReadableStream`-backed bodies work (today only native bodies do).
blast radius: low - HTMLRewriter usage is modest and the `Response`→`Response` path is the common one.
confidence: high.

### Consuming a disturbed stream silently returns `""` instead of throwing

what: `Bun.readableStreamToText()` (and the other consumers, and the prototype `.text()`) return an empty result on a second consume instead of rejecting with "ReadableStream is locked" as the spec and every other runtime do.
where: `src/js/builtins/ReadableStream.ts:117-338` (the `$isReadableStreamLocked` guards), `src/js/builtins/ReadableStreamInternals.ts:1240-1268` (`tryUseReadableStreamBufferedFastPath` checks `$isReadableStreamDisturbed` but the non-native path does not).
evidence:
  - Issue #6860 (open): "Reusing an already consumed `ReadableStream` should always cause a `ReadableStream is locked` error" - "Bun like Node should always throw".
  - Verified on Bun 1.4: `await Bun.readableStreamToText(body); await Bun.readableStreamToText(body)` → `["abc", ""]` for a `Response` body and `["hi", ""]` for a `type:"direct"` stream. No error.
why bad: Silent data truncation. The guards check `locked` but not `disturbed`, because once the first consumer finishes it releases the lock. A program that double-reads gets `""` and has no way to know.
bun 2.0 proposal: Reject the consumer functions (and the prototype methods) if `disturbed`, matching `Response.prototype.*`. This is a behavior break, which is why it's a 2.0 item.
blast radius: low - only already-buggy code observes the difference.
confidence: high.

### Non-standard statics/methods on `FormData` and `Blob` that nobody documents

what: `FormData.from(blob, contentType)` is a public, enumerable-in-practice static on the global `FormData` constructor, and `Blob.prototype.json()` / `Blob.prototype.formData()` are non-standard instance methods - all present at runtime, none in the File API/XHR specs, `FormData.from` absent even from `@types/bun`.
where: `src/jsc/bindings/webcore/JSDOMFormData.cpp:196` (`putDirectNativeFunction(... vm.propertyNames->from ... ImplementationVisibility::Public ...)`), `packages/bun-types/overrides.d.ts:37-66` (`declare module "buffer"` adds `json()`, `formData()`, `image()` to `Blob`).
evidence:
  - Verified: `typeof FormData.from === "function"`, `typeof Blob.prototype.json === "function"`, `typeof Blob.prototype.formData === "function"` on Bun 1.4. `FormData.from` does not appear anywhere in `packages/bun-types/`.
  - `Bun.readableStreamToFormData` is just `Bun.readableStreamToBlob(stream).then(blob => FormData.from(blob, contentType))` (`ReadableStream.ts:308`), so the undocumented static is load-bearing.
  - `Bun.readableStreamToFormData(stream, multipartBoundaryExcludingDashes)` (`bun.d.ts:1809-1812`) is a modal API: with no second arg it parses `x-www-form-urlencoded`; with a boundary it parses `multipart/form-data`. The standard equivalent, `new Response(stream, {headers: {"content-type": ...}}).formData()`, derives both from one header.
why bad: Same class of problem as `Blob.stream(chunkSize)`: additions to standard globals that the platform may later specify differently. `Blob` already has standard `.text()`, `.arrayBuffer()`, `.bytes()`; adding `.json()` and `.formData()` is gratuitous.
bun 2.0 proposal: Remove `FormData.from` from the public namespace (keep it internal). Drop `Blob.prototype.json`/`.formData` or mark them clearly Bun-only; drop `Bun.readableStreamToFormData` with the rest of the family.
blast radius: low - undocumented and rarely discovered.
confidence: high (evidence); medium (that the team would act on it).

### `UnderlyingSource.type?: undefined` - "Mode 'bytes' is not supported" is false

what: The public types for the *standard* `ReadableStream` constructor claim byte streams are unsupported, steering users to the non-standard `type: "direct"` overload that sits right below it.
where: `packages/bun-types/bun.d.ts:304-314`.
evidence:
  - Verbatim, `bun.d.ts:304-307`:
    ```ts
    /**
     * Mode "bytes" is not supported.
     */
    type?: undefined;
    ```
  - Verified false: `new ReadableStream({type:"bytes", start(c){c.enqueue(new Uint8Array([1,2,3])); c.close()}}).getReader({mode:"byob"}).read(new Uint8Array(3))` returns `Uint8Array(3) [1,2,3]` on Bun 1.4. `ReadableStreamInternals.ts:192-203` constructs a `ReadableByteStreamController`. One open byte-stream bug exists (#32402, BYOB detach) but the feature works.
  - In-source history comment, `ReadableStreamInternals.ts:2132-2134`: "This was a type: 'bytes' until Bun v1.1.44, but pendingPullIntos was not really compatible with how we send data to the stream, and 'mode: byob' wasn't supported so changing it isn't an observable change." - i.e., native file/fetch streams silently *stopped* being byte streams (so `Bun.file(x).stream().getReader({mode:"byob"})` diverges from `response.body.getReader({mode:"byob"})` in browsers and Node).
why bad: The TypeScript surface is the de-facto documentation, and it currently lies in the direction that maximizes adoption of Bun's proprietary `type: "direct"`.
bun 2.0 proposal: Fix the type to `type?: undefined | "bytes"` now (1.x, no break needed). For 2.0, make `Bun.file().stream()` and `response.body` byte streams again so BYOB works as it does in every other runtime.
blast radius: low (types fix) / medium (making native streams byte streams again).
confidence: high.

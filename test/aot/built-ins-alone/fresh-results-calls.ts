// The rows of ./fresh-results.ts that no call written from the table's own types reaches. `calls`: the statements of an async function; the last line is the expression whose value is
// judged. An `import { a } from "b";` line loads a module. `notCalled`: why a row is not called at all.
const temporary =
  'import { mkdtempSync } from "node:fs";\nimport { tmpdir } from "node:os";\nconst folder = mkdtempSync(tmpdir() + "/fresh-results-");';
const served = 'const server = Bun.serve({ port: 0, fetch: () => new Response("[1.5]") });';

const internals = 'import { privateGlobalFunctions } from "bun:internal-for-testing";';

/** What a handler of a server is handed. `more` are options of the server, `asked` is what the client does with `server`. */
const handedToServer = (more: string, asked: string, start = "Bun.serve") => [
  "const { promise, resolve } = Promise.withResolvers();",
  `const server = ${start}({ port: 0, fetch: () => new Response("x"), ${more} });`,
  asked,
  "const handed = await promise;",
  "await server.stop(true);",
  "handed",
];
const reloaded =
  'const first = Bun.serve({ port: 0, fetch: () => new Response("x") });\nconst reload = options => (first.reload(options), first);';
const requestHandler = 'fetch: request => (resolve(request), new Response("x"))';
const routeHandler = 'routes: { "/:name": request => (resolve(request), new Response("x")) }';
const get = 'await fetch(new URL("/a", server.url));';
const upgrades = "fetch: (request, server) => void server.upgrade(request)";
const dials = (then: string) => `const client = new WebSocket(server.url.href.replace("http", "ws"));\n${then}`;
const closes = "promise.then(() => client.close());";
const says = (binaryType: string) =>
  handedToServer(
    `${upgrades}, websocket: { binaryType: "${binaryType}", message: (socket, message) => resolve(message) }`,
    dials(`client.onopen = () => client.send(new Uint8Array([1, 2]));\n${closes}`),
  ).join("\n");

/** What a handler of a socket is handed. */
const handedToSocket = (side: "listen" | "connect", handler: string, binaryType = "buffer") =>
  [
    "const { promise, resolve } = Promise.withResolvers();",
    'const quiet = { data() {}, open(socket) {\n  socket.write("a");\n}, close() {}, error() {} };',
    `const loud = { ...quiet, binaryType: "${binaryType}", ${handler} };`,
    `const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: ${side === "listen" ? "loud" : "quiet"} });`,
    `const socket = await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: ${side === "connect" ? "loud" : "quiet"} });`,
    "const handed = await promise;",
    "socket.end();",
    "listener.stop(true);",
    "handed",
  ].join("\n");
const opened = 'open(socket) {\n  socket.write("a");\n  resolve(socket);\n}';
const told = "data: (socket, data) => resolve(data)";

// A server with `development: true` is of the class of a server without it in a build without assertions.
const ofServers = (member: string, classes: string, text: string[]) =>
  Object.fromEntries([`%HTTPServer%.prototype.${member} > ${classes}`].map(key => [key, text]));

export const calls: Record<string, string[]> = {
  "crypto > Crypto": ["crypto"],
  "Bun.serve > ServerWebSocket": [
    handedToServer(`${upgrades}, websocket: { open: resolve, message() {} }`, dials(closes)).join("\n"),
  ],
  "Bun.serve > Request": [handedToServer(requestHandler, get).join("\n")],
  "Bun.serve > BunRequest": [handedToServer(routeHandler, get).join("\n")],
  "Bun.serve > ArrayBuffer Blob Buffer Uint8Array": [says("nodebuffer"), says("arraybuffer"), says("uint8array")],
  ...ofServers("reload", "ServerWebSocket", [
    [
      reloaded,
      ...handedToServer(`${upgrades}, websocket: { open: resolve, message() {} }`, dials(closes), "reload"),
    ].join("\n"),
  ]),
  ...ofServers("reload", "Request", [[reloaded, ...handedToServer(requestHandler, get, "reload")].join("\n")]),
  ...ofServers("reload", "BunRequest", [[reloaded, ...handedToServer(routeHandler, get, "reload")].join("\n")]),
  ...ofServers("reload", "ArrayBuffer Blob Buffer Uint8Array", [
    [
      reloaded,
      ...handedToServer(
        `${upgrades}, websocket: { message: (socket, message) => resolve(message) }`,
        dials(`client.onopen = () => client.send(new Uint8Array([1, 2]));\n${closes}`),
        "reload",
      ),
    ].join("\n"),
  ]),
  ...ofServers("fetch", "Request", [handedToServer(requestHandler, 'await server.fetch("/a");').join("\n")]),
  "%PrivateGlobals%.webStreamClosedPromise > Promise": [
    `${internals}\nprivateGlobalFunctions.webStreamClosedPromise(new ReadableStream())`,
  ],
  "%PrivateGlobals%.makeAbortError": [
    `${internals}\nprivateGlobalFunctions.makeAbortError("m")`,
    `${internals}\nprivateGlobalFunctions.makeAbortError(undefined, { cause: 1 })`,
  ],
  "%PrivateGlobals%.makeErrorWithCode": [
    `${internals}\nprivateGlobalFunctions["makeErrorWithCode ERR_OUT_OF_RANGE"]("a", "b", 1)`,
    `${internals}\nprivateGlobalFunctions["makeErrorWithCode ERR_INVALID_ARG_VALUE"]("a", 1, "b")`,
    `${internals}\nprivateGlobalFunctions["makeErrorWithCode ERR_INVALID_STATE"]("a")`,
    `${internals}\nprivateGlobalFunctions["makeErrorWithCode ERR_MISSING_ARGS"]("a", "b", "c")`,
  ],
  "node:module.builtinModules > Array": ['import { builtinModules } from "node:module";\nbuiltinModules'],
  "node:string_decoder.StringDecoder > NodeString_decoderStringDecoder": [
    'import { StringDecoder } from "node:string_decoder";\nStringDecoder("utf8")',
  ],
  "Bun.listen > TCPSocket TLSSocket": [handedToSocket("listen", opened)],
  "Bun.connect > TCPSocket TLSSocket": [handedToSocket("connect", opened)],
  "Bun.listen > Buffer": [handedToSocket("listen", told)],
  "Bun.connect > Buffer": [handedToSocket("connect", told)],
  "Bun.listen > ArrayBuffer Buffer Uint8Array": [
    handedToSocket("listen", told, "arraybuffer"),
    handedToSocket("listen", told, "uint8array"),
  ],
  "Bun.connect > ArrayBuffer Buffer Uint8Array": [
    handedToSocket("connect", told, "arraybuffer"),
    handedToSocket("connect", told, "uint8array"),
  ],
  "Bun.stderr > Blob": ["Bun.stderr"],
  "Bun.stdin > Blob": ["Bun.stdin"],
  "Bun.stdout > Blob": ["Bun.stdout"],
  "process.argv > Array": ["process.argv"],
  "process.execArgv > Array": ["process.execArgv"],
  "AbortController.prototype.signal > AbortSignal": ["new AbortController().signal"],
  "Request.prototype.headers > Headers": [
    'new Request("https://example.com/a").headers',
    'new Request("https://example.com/a", { headers: { first: "1" } }).headers',
    [...handedToServer(requestHandler, get).slice(0, -1), "handed.headers"].join("\n"),
  ],
  "Response.prototype.headers > Headers": [
    'new Response("x").headers',
    'Response.json(1, { headers: { first: "1" } }).headers',
  ],
  "TextEncoderStream.prototype.readable > ReadableStream": ["new TextEncoderStream().readable"],
  "TextEncoderStream.prototype.writable > WritableStream": ["new TextEncoderStream().writable"],
  "TransformStream.prototype.readable > ReadableStream": ["new TransformStream().readable"],
  "TransformStream.prototype.writable > WritableStream": ["new TransformStream().writable"],
  "URL.prototype.searchParams > URLSearchParams": ['new URL("https://example.com/a?first=1").searchParams'],
  "WebAssembly.Memory.prototype.buffer > ArrayBuffer SharedArrayBuffer": [
    "new WebAssembly.Memory({ initial: 1 }).buffer",
    "new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true }).buffer",
  ],
  "WebAssembly.Memory.prototype.toFixedLengthBuffer > ArrayBuffer SharedArrayBuffer": [
    "new WebAssembly.Memory({ initial: 1 }).toFixedLengthBuffer()",
  ],
  "WebAssembly.Memory.prototype.toResizableBuffer > ArrayBuffer SharedArrayBuffer": [
    "new WebAssembly.Memory({ initial: 1, maximum: 2 }).toResizableBuffer()",
  ],
  ...Object.fromEntries(
    [
      ["addListener", '"x", () => {}'],
      ["emit", '"x"'],
      ["eventNames", ""],
      ["getMaxListeners", ""],
      ["listenerCount", '"x"'],
      ["listeners", '"x"'],
      ["off", '"x", () => {}'],
      ["on", '"x", () => {}'],
      ["once", '"x", () => {}'],
      ["prependListener", '"x", () => {}'],
      ["prependOnceListener", '"x", () => {}'],
      ["rawListeners", '"x"'],
      ["removeAllListeners", ""],
      ["removeListener", '"x", () => {}'],
      ["setMaxListeners", "1"],
    ].map(([name, operands]) => [
      `%EventEmitter%.prototype.${name} > EventEmitter`,
      [`const other = {};\nprocess.${name}.call(other${operands === "" ? "" : `, ${operands}`});\nother._events`],
    ]),
  ),
  "native:Bindgen:Counters.bind.ts:createCountersObject": [
    'import { getCounters } from "bun:internal-for-testing";\ngetCounters()',
  ],
  "native:Bindgen:dns_internals.bind.ts:seedCacheForTesting": [
    'import { dnsCacheSeed } from "bun:internal-for-testing";\ndnsCacheSeed("fresh-results.invalid", ["127.0.0.1", "::1"])',
  ],
  "native:Bindgen:event_loop.bind.ts:getActiveTasks": [
    'import { getEventLoopStats } from "bun:internal-for-testing";\ngetEventLoopStats()',
  ],
  "native:Bindgen:headers_jsc.bind.ts:h2LiveCounts": [
    'import { fetchH2Internals } from "bun:internal-for-testing";\nfetchH2Internals.liveCounts()',
  ],
  "native:Bindgen:headers_jsc.bind.ts:h3LiveCounts": [
    'import { fetchH3Internals } from "bun:internal-for-testing";\nfetchH3Internals.liveCounts()',
  ],
  "native:Bindgen:linear_fifo_testing.bind.ts:orderedRemoveProbe": [
    'import { linearFifoOrderedRemoveProbe } from "bun:internal-for-testing";\nlinearFifoOrderedRemoveProbe(0)',
  ],
  "native:Bindgen:node_fs_binding.bind.ts:rmOptionsForTesting": [
    `import { exposedInternals } from "bun:internal-for-testing";\n${temporary}\nexposedInternals["internal/fs/utils"].validateRmOptionsSync(folder, { recursive: true, force: true }, false)`,
  ],
  "native:Bindgen:pack_command.bind.ts:readTarball": [
    `import { readTarball } from "bun:internal-for-testing";\n${temporary}\nawait Bun.write(folder + "/a.tgz", await new Bun.Archive({ "package/package.json": "{}" }, { compress: "gzip" }).bytes());\nreadTarball(folder + "/a.tgz")`,
  ],
  "native:NewCppFunction:NodeTLS.cpp:getBundledRootCertificates": [
    'import { getCACertificates } from "node:tls";\nconst list = getCACertificates("bundled");\nlist',
  ],
  "native:NewCppFunction:NodeTLS.cpp:getExtraCACertificates": [
    'import { getCACertificates } from "node:tls";\nconst list = getCACertificates("extra");\nlist',
  ],
  "native:NewCppFunction:NodeTLS.cpp:getSystemCACertificates": [
    'import { getCACertificates } from "node:tls";\nconst list = getCACertificates("system");\nlist',
  ],
  "%FrameworkFileSystemRouter%": [
    `import { frameworkRouterInternals } from "bun:internal-for-testing";\n${temporary}\nnew frameworkRouterInternals.FrameworkRouter({ root: folder, style: "nextjs-pages" })`,
  ],
  "%NodeHTTPResponse%.prototype.ondata > Buffer": [
    [
      'import { createServer } from "node:http";',
      "const { promise, resolve } = Promise.withResolvers();",
      "const server = createServer((request, response) => {",
      '  request.on("data", resolve);',
      '  response.end("x");',
      "}).listen(0);",
      'await new Promise(listening => server.on("listening", listening));',
      'await fetch("http://127.0.0.1:" + server.address().port, { method: "POST", body: "abc" });',
      "const handed = await promise;",
      "server.close();",
      "handed",
    ].join("\n"),
  ],
  "native:Bindgen:FrameworkRouter.bind.ts:parseRoutePattern": [
    'import { frameworkRouterInternals } from "bun:internal-for-testing";\nframeworkRouterInternals.parseRoutePattern("nextjs-pages", "/a/[b].tsx")',
  ],
  "native:Bindgen:InternalSourceMap.bind.ts:find": [
    'import { internalSourceMap } from "bun:internal-for-testing";\ninternalSourceMap.find(internalSourceMap.fromVLQ("AAAA;AACA"), 1, 0)',
  ],
  "native:Bindgen:error_jsc.bind.ts:sigactionLayout": [
    'import { sigactionLayout } from "bun:internal-for-testing";\nsigactionLayout()',
  ],
  "native:Bindgen:hosted_git_info_jsc.bind.ts:fromUrl": [
    'import { hostedGitInfo } from "bun:internal-for-testing";\nhostedGitInfo.fromUrl("github:a/b")',
  ],
  "native:Bindgen:proxy_testing.bind.ts:parseURL": [
    'import { proxyInternals } from "bun:internal-for-testing";\nproxyInternals.parseURL("http://u:p@a.b:1/c")',
  ],
  "%HTTPServer%.prototype.address": [`${served}\nconst address = server.address;\nawait server.stop(true);\naddress`],
  "%HTTPServer%.prototype.requestIP": [
    handedToServer('fetch: (request, server) => (resolve(server.requestIP(request)), new Response("x"))', get).join(
      "\n",
    ),
  ],
  "%IntlSegments%.prototype.containing": ['new Intl.Segmenter("en").segment("ab").containing(0)'],
  "Bun.dns.getCacheStats": ["Bun.dns.getCacheStats()"],
  "WebAssembly.Module.exports": [
    "WebAssembly.Module.exports(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 4, 1, 2, 0, 11])))",
  ],
  "WebAssembly.Module.imports": [
    "WebAssembly.Module.imports(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 7, 1, 1, 97, 1, 98, 0, 0])))",
  ],
  "Intl.DurationFormat.prototype.formatToParts": [
    'new Intl.DurationFormat("en").formatToParts({ hours: 1, minutes: 2 })',
  ],
  "Intl.RelativeTimeFormat.prototype.formatToParts": ['new Intl.RelativeTimeFormat("en").formatToParts(1, "day")'],
  "native:Bindgen:node_os.bind.ts:loadavg": ['import { loadavg } from "node:os";\nloadavg()'],
  "native:Bindgen:node_path.bind.ts:parsePosix": ['import { posix } from "node:path";\nposix.parse("/a/b.c")'],
  "native:Bindgen:node_path.bind.ts:parseWin32": ['import { win32 } from "node:path";\nwin32.parse("C:\\\\a\\\\b.c")'],
  "native:Bindgen:socket_body.bind.ts:createSocketPair": [
    'import { createSocketPair } from "bun:internal-for-testing";\nimport { closeSync } from "node:fs";\nconst pair = createSocketPair();\npair.forEach(each => closeSync(each));\npair',
  ],
  "%CrashHandlerJscCrashHandler%.getFeatureData": [
    'import { crash_handler } from "bun:internal-for-testing";\ncrash_handler.getFeatureData()',
  ],
  "%NodeCryptoBindingCrypto%.getHashes": ['import { getHashes } from "node:crypto";\ngetHashes()'],
  "%Generator%.prototype.throw": [
    "function* numbers() {\n  try {\n    yield 1;\n  } catch {\n    yield 2;\n  }\n}\nconst generator = numbers();\ngenerator.next();\ngenerator.throw(1)",
  ],
  "%BunRequest%.prototype.clone": [
    'let asked;\nconst server = Bun.serve({\n  port: 0,\n  routes: {\n    "/:name": request => {\n      asked = request.clone();\n      return new Response("x");\n    },\n  },\n});\nawait fetch(new URL("/a", server.url));\nawait server.stop(true);\nasked',
  ],
  "%BlockList%": ['import { BlockList } from "node:net";\nnew BlockList()'],
  "%SocketAddress%": [
    'import { SocketAddress } from "node:net";\nnew SocketAddress({ address: "127.0.0.1", port: 1 })',
  ],
  "%NativeZlib%": ['import { createGzip } from "node:zlib";\nnew (createGzip()._handle.constructor)(1)'],
  "%NativeBrotli%": [
    'import { createBrotliCompress } from "node:zlib";\nnew (createBrotliCompress()._handle.constructor)(8)',
  ],
  "%NativeZstd%": [
    'import { createZstdCompress } from "node:zlib";\nnew (createZstdCompress()._handle.constructor)(10)',
  ],
  "%SecureContext%": ['import { createSecureContext } from "node:tls";\ncreateSecureContext().context'],
  "%TypedArray%": ["new Uint8Array(2)"],
  CompressionStream: ['new CompressionStream("gzip")'],
  DecompressionStream: ['new DecompressionStream("gzip")'],
  FinalizationRegistry: ["new FinalizationRegistry(() => {})"],
  HTMLRewriter: ["new HTMLRewriter()"],
  Iterator: ["new (class extends Iterator {})()"],
  URL: ['new URL("https://user:secret@example.com:8080/a/b?first=1#part")', 'new URL("/a", "https://example.com")'],
  Worker: [
    'const worker = new Worker(URL.createObjectURL(new Blob([""], { type: "text/javascript" })));\nworker.unref();\nworker.terminate();\nworker',
  ],
  fetch: [`${served}\nconst asked = fetch(server.url);\nawait asked;\nawait server.stop(true);\nasked`],
  "Bun.fetch": [`${served}\nconst asked = Bun.fetch(server.url);\nawait asked;\nawait server.stop(true);\nasked`],
  "node:string_decoder.StringDecoder": [
    'import { StringDecoder } from "node:string_decoder";\nnew StringDecoder("utf8")',
  ],
  "node:string_decoder.StringDecoder.prototype.lastChar": [
    'import { StringDecoder } from "node:string_decoder";\nnew StringDecoder("utf8").lastChar',
  ],
  "AbortSignal.abort": ["AbortSignal.abort()", 'AbortSignal.abort("why")'],
  "AbortSignal.any": ["AbortSignal.any([new AbortController().signal])", "AbortSignal.any([AbortSignal.abort()])"],
  "AbortSignal.timeout": ["AbortSignal.timeout(1)"],
  "Buffer.concat": ['Buffer.concat([Buffer.from("a"), Buffer.from("b")])', "Buffer.concat([])"],
  "Bun.Archive": ['new Bun.Archive({ "a.txt": "a" })'],
  "Bun.CryptoHasher": ['new Bun.CryptoHasher("sha256")', 'new Bun.CryptoHasher("sha256", "key")'],
  "Bun.FileSystemRouter": [`${temporary}\nnew Bun.FileSystemRouter({ style: "nextjs", dir: folder })`],
  "Bun.S3Client": ["new Bun.S3Client({})"],
  "Bun.Transpiler": ["new Bun.Transpiler()"],
  "Bun.Transpiler.prototype.scan": ['new Bun.Transpiler().scan(`import a from "b"; export const c = a;`)'],
  "Bun.Transpiler.prototype.scanImports": ['new Bun.Transpiler().scanImports(`import a from "b";`)'],
  "Bun.Transpiler.prototype.transform": ['new Bun.Transpiler().transform("const a = 1;")'],
  "Bun.build": [
    `${temporary}\nawait Bun.write(folder + "/a.js", "export default 1;");\nconst asked = Bun.build({ entrypoints: [folder + "/a.js"] });\nawait asked;\nasked`,
  ],
  "Bun.connect": [
    'const handlers = { data() {}, open() {}, close() {}, error() {} };\nconst listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: handlers });\nconst asked = Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: handlers });\n(await asked).end();\nlistener.stop(true);\nasked',
  ],
  "Bun.cron": ['const job = Bun.cron("0 0 1 1 *", () => {});\njob.stop();\njob'],
  "Bun.file": [
    'Bun.file("/does/not/exist")',
    "Bun.file(0)",
    'Bun.file("s3://bucket/key")',
    'Bun.file(new URL("file:///a"))',
  ],
  "Bun.generateHeapSnapshot": ['Bun.generateHeapSnapshot("v8", "arraybuffer")', "Bun.generateHeapSnapshot()"],
  "Bun.listen": [
    'const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });\nlistener.stop(true);\nlistener',
  ],
  "Bun.resolve": ['Bun.resolve("node:fs", "/")'],
  "Bun.serve": [`${served}\nawait server.stop(true);\nserver`],
  "Bun.sleep": ["Bun.sleep(1)", "Bun.sleep(new Date())"],
  "Bun.spawnSync": [
    'Bun.spawnSync(["true"])',
    'Bun.spawnSync({ cmd: ["true"], stdout: "pipe", stderr: "pipe" })',
    'Bun.spawnSync({ cmd: ["sleep", "5"], timeout: 1 })',
    'Bun.spawnSync({ cmd: ["true"], stdout: "ignore", stderr: "inherit" })',
    'Bun.spawnSync({ cmd: ["echo", "aaaa"], maxBuffer: 1 })',
  ],
  "Bun.udpSocket": ["const asked = Bun.udpSocket({});\n(await asked).close();\nasked"],
  "Bun.write": [
    `${temporary}\nBun.write(folder + "/a", "a")`,
    `${temporary}\nBun.write(Bun.file(folder + "/b"), new Response("b"))`,
  ],
  "WebAssembly.CompileError": ['new WebAssembly.CompileError("m")', 'WebAssembly.CompileError("m")'],
  "WebAssembly.LinkError": ['new WebAssembly.LinkError("m")', 'WebAssembly.LinkError("m")'],
  "WebAssembly.RuntimeError": ['new WebAssembly.RuntimeError("m")', 'WebAssembly.RuntimeError("m")'],
  "WebAssembly.SuspendError": ['new WebAssembly.SuspendError("m")', 'WebAssembly.SuspendError("m")'],
  "WebAssembly.Exception": ['new WebAssembly.Exception(new WebAssembly.Tag({ parameters: ["i32"] }), [1])'],
  "WebAssembly.Global": ['new WebAssembly.Global({ value: "i32", mutable: true }, 1)'],
  "WebAssembly.Memory": ["new WebAssembly.Memory({ initial: 1 })"],
  "WebAssembly.Module": ["new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))"],
  "WebAssembly.Table": ['new WebAssembly.Table({ element: "anyfunc", initial: 1 })'],
  "WebAssembly.Tag": ['new WebAssembly.Tag({ parameters: ["i32"] })'],
  "WebAssembly.compile": ["WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))"],
  "WebAssembly.Module.customSections": [
    'WebAssembly.Module.customSections(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 0, 3, 1, 97, 1])), "a")',
  ],
  "process._getActiveHandles": ["process._getActiveHandles()"],
  "process._getActiveRequests": ["process._getActiveRequests()"],
  "Blob.prototype.delete": [`${temporary}\nawait Bun.write(folder + "/a", "a");\nBun.file(folder + "/a").delete()`],
  "Blob.prototype.unlink": [
    `${temporary}\nawait Bun.write(folder + "/a", "a");\nBun.file(folder + "/a").unlink()`,
    'Bun.file("/does/not/exist").unlink()',
  ],
  "Blob.prototype.write": [`${temporary}\nBun.file(folder + "/a").write("a")`],
  "Blob.prototype.writer": [`${temporary}\nconst sink = Bun.file(folder + "/a").writer();\nawait sink.end();\nsink`],
  "Bun.dns.lookup": ['Bun.dns.lookup("localhost")'],
  "Iterator.prototype.chunks": ["[1, 2, 3].values().chunks(2)"],
  "Iterator.prototype.windows": ["[1, 2, 3].values().windows(2)"],
  "Request.prototype.clone": ['new Request("https://example.com/a", { method: "POST", body: "a" }).clone()'],
  "Uint8Array.prototype.setFromHex": ['new Uint8Array(2).setFromHex("ff01")'],
};

const temporalSamples: Record<string, string> = {
  Duration: 'Temporal.Duration.from("PT1H")',
  Instant: 'Temporal.Instant.from("2020-01-01T00:00Z")',
  PlainDate: 'Temporal.PlainDate.from("2020-01-01")',
  PlainDateTime: 'Temporal.PlainDateTime.from("2020-01-01T00:00")',
  PlainMonthDay: 'Temporal.PlainMonthDay.from("01-01")',
  PlainTime: 'Temporal.PlainTime.from("01:00")',
  PlainYearMonth: 'Temporal.PlainYearMonth.from("2020-01")',
  ZonedDateTime: 'Temporal.ZonedDateTime.from("2020-01-01T00:00[UTC]")',
};

/** Rows that are called with the first of `operands` that they take. */
export const families: { rows: RegExp; callee(path: string, mode: string): string | null; operands: string[] }[] = [
  {
    rows: /^Temporal\./,
    callee(path, mode) {
      const method = /^Temporal\.([A-Za-z]+)\.prototype\.([A-Za-z]+)$/.exec(path);
      if (method !== null) return `${temporalSamples[method[1]]}.${method[2]}`;
      return mode === "Construct" ? `new ${path}` : path;
    },
    operands: [
      "",
      '"PT1H"',
      "{ hours: 1 }",
      "{ days: 1 }",
      "{ months: 1 }",
      '"2020-01-02"',
      '"2020-01-02T00:00Z"',
      '"2020-01-02T00:00"',
      '"2020-01-02T00:00[UTC]"',
      '"02:00"',
      '"2020-02"',
      '"01-02"',
      '"UTC"',
      '"iso8601"',
      '"next"',
      '{ smallestUnit: "hour" }',
      '{ smallestUnit: "day" }',
      "{ year: 2021 }",
      "{ day: 2 }",
      "{ hour: 2 }",
      "{ month: 2 }",
      "0",
      "0n",
      '0n, "UTC"',
      "2020, 1, 1",
      "2020, 1",
      "1, 1",
    ],
  },
];

/** Objects of the table whose link upwards a library module changes when it is loaded, which the compiler sees it do. */
export const linkedByLibraryCode: Record<string, string> = {
  "%EventEmitter%.prototype": "node:events puts it below its own EventEmitter.prototype",
};

const ofTheEngine = "a private function of the engine's own library code: no other text can name it";
const ofTheCompiler = "the compiler puts it in the place of other calls: only compiled code calls it";
const ofOneModule = (module: string) => `only ${module} holds it, and hands it to nobody`;
const withCertificate =
  "it takes a server with a certificate; the native code that makes the object is the one of a server without";
const withAssertions = "no server is of this class in a build without assertions";
const alwaysThrows = "the constructor throws whatever it is given";

/** Rows that are not called, by what their paths look like. */
export const familiesNotCalled: { rows: RegExp; why: string }[] = [
  {
    rows: /_test\.bind\.ts:|^%NativeFunctions%\.[A-Za-z0-9_]+_testBindTs/,
    why: "it exists for the tests of the generator of bindings, and only a build with assertions has it",
  },
];

export const notCalled: Record<string, string> = {
  "%Expect%": alwaysThrows,
  "%ExpectTypeOf%": alwaysThrows,
  "%ServerWebSocket%": alwaysThrows,
  "%LinkTimeConstant:arrayFromFastWithoutMapFn%": ofTheEngine,
  "%LinkTimeConstant:asyncFromSyncIteratorCreate%": ofTheEngine,
  "%LinkTimeConstant:iteratorHelperCreate%": ofTheEngine,
  "%LinkTimeConstant:makeTypeError%": ofTheEngine,
  "%LinkTimeConstant:newRejectedPromise%": ofTheEngine,
  "%LinkTimeConstant:newResolvedPromise%": ofTheEngine,
  "%LinkTimeConstant:promiseReject%": ofTheEngine,
  "%LinkTimeConstant:promiseResolve%": ofTheEngine,
  "%LinkTimeConstant:typedArrayFromFast%": ofTheEngine,
  "%LinkTimeConstant:wrapForValidIteratorCreate%": ofTheEngine,
  "%CompilerHelpers%.TextEncoder_prototype_encodeInto_inRanges": ofTheCompiler,
  "%CompilerHelpers%.arrayFromLength": ofTheCompiler,
  "%CompilerHelpers%.arrayOfUndefined": ofTheCompiler,
  "%CompilerHelpers%.filledArray": ofTheCompiler,
  "%CompilerHelpers%.jsonSourceOfBody": ofTheCompiler,
  "%CompilerHelpers%.mappedFilledArray": ofTheCompiler,
  "%CompilerHelpers%.newResponseFromParts": ofTheCompiler,
  "%CompilerHelpers%.ownEntriesFlat": ofTheCompiler,
  "%CompilerHelpers%.plainQueryEntries": ofTheCompiler,
  "%CompilerHelpers%.plainQueryKeys": ofTheCompiler,
  "%CompilerHelpers%.plainQueryValues": ofTheCompiler,
  "native:Bindgen:node_fs_binding.bind.ts:binding": ofOneModule("internal/fs/binding"),
  "native:Bindgen:node_util_binding.bind.ts:extractedSplitNewLinesFastPathStringsOnly":
    ofOneModule("internal/util/inspect"),
  "native:Bindgen:node_util_binding.bind.ts:internalErrorEntries": ofOneModule("node:util"),
  "native:Cpp:NodeURL.cpp:Bun::createNodeURLBinding": ofOneModule("internal/url"),
  "native:NewCppFunction:BunCompiledModules.cpp:jsFunctionCallOwnFunctionsWithoutParameters": ofOneModule(
    "ahead-of-time/internal/primordials",
  ),
  "native:NewCppFunction:NodeTLS.cpp:parseCACertificates": ofOneModule("node:tls"),
  "native:NewCppFunction:UtilInspect.cpp:jsFunctionGetOwnNonIndexProperties": ofOneModule("internal/util/inspect"),
  "%NpmJscNpmManifestTestHelpers%.parseManifest": "it reads a manifest that `bun install` has stored",
  "node:module.findSourceMap": "it answers undefined for every file that was tried",
  "Bun.secrets.delete": "it writes to the store of secrets of the operating system",
  "Bun.secrets.get": "the store of secrets of the operating system may ask the person at the machine",
  "Bun.secrets.set": "it writes to the store of secrets of the operating system",
  "process.nextTick > Array": "the list goes to a function of internal/process/task_queues, which hands it to nobody",
  ...Object.fromEntries(
    ["ServerWebSocket", "Request", "BunRequest", "ArrayBuffer Blob Buffer Uint8Array"].flatMap(classes => [
      [`%HTTPSServer%.prototype.reload > ${classes}`, withCertificate],
      [`%DebugHTTPSServer%.prototype.reload > ${classes}`, withAssertions],
      [`%DebugHTTPServer%.prototype.reload > ${classes}`, withAssertions],
    ]),
  ),
  "%HTTPSServer%.prototype.address": withCertificate,
  "%DebugHTTPSServer%.prototype.address": withAssertions,
  "%DebugHTTPServer%.prototype.address": withAssertions,
  "%HTTPSServer%.prototype.requestIP": withCertificate,
  "%DebugHTTPSServer%.prototype.requestIP": withAssertions,
  "%DebugHTTPServer%.prototype.requestIP": withAssertions,
  "%HTTPSServer%.prototype.fetch > Request": withCertificate,
  "%DebugHTTPSServer%.prototype.fetch > Request": withAssertions,
  "%DebugHTTPServer%.prototype.fetch > Request": withAssertions,
};

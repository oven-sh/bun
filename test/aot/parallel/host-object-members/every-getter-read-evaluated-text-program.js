// The program names nothing but console, process and eval. Text that nobody has seen makes objects of the host and of the library and reads every accessor that it finds on them and above them.
// Each read answers what plain Bun answers, or throws the error that says what was left out. It never answers something else.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const text = `(function () {
  const stream = new Proxy({}, { get(target, name) { return process.getBuiltinModule("node:stream")[name]; } });
  const subjects = {
    buffer: () => Buffer.from("abc"),
    url: () => new URL("https://user:word@example.com:8080/a/b?x=1#h"),
    searchParams: () => new URLSearchParams("a=1&b=2"),
    headers: () => new Headers({ a: "1" }),
    request: () => new Request("https://example.com/x", { method: "POST", body: "b" }),
    response: () => new Response("body", { status: 201 }),
    blob: () => new Blob(["abc"]),
    process: () => process,
    readable: () => new stream.Readable({ read() {} }),
    writable: () => new stream.Writable({ write(chunk, encoding, done) { done(); } }),
    duplex: () => new stream.Duplex({ read() {}, write(chunk, encoding, done) { done(); } }),
    transform: () => new stream.Transform({ transform(chunk, encoding, done) { done(); } }),
    passThrough: () => new stream.PassThrough(),
    abortController: () => new AbortController(),
    event: () => new Event("x"),
    textDecoder: () => new TextDecoder(),
    error: () => new Error("x"),
    map: () => new Map([[1, 2]]),
    typedArray: () => new Uint8Array(3),
    regExp: () => /a/gi,
    arrayBuffer: () => new ArrayBuffer(8),
    dataView: () => new DataView(new ArrayBuffer(8), 2),
    set: () => new Set([1]),
    symbol: () => Object(Symbol("x")),
    readableStream: () => new ReadableStream({ start() {} }),
    reader: () => new ReadableStream({ start() {} }).getReader(),
    writableStream: () => new WritableStream({}),
    writer: () => new WritableStream({}).getWriter(),
    transformStream: () => new TransformStream(),
    file: () => Bun.file("/nothing-there.txt"),
    formData: () => new FormData(),
    port: () => new MessageChannel().port1,
    performance: () => performance,
    navigator: () => navigator,
    customEvent: () => new CustomEvent("x", { detail: 1 }),
    abortSignal: () => AbortSignal.abort(),
    textEncoder: () => new TextEncoder(),
    domException: () => new DOMException("m", "AbortError"),
    eventEmitter: () => new (process.getBuiltinModule("node:events"))(),
  };
  const unstable = new Set(["process.pid", "process.ppid", "process.title", "process.execPath", "process.argv0", "process.debugPort", "event.timeStamp", "customEvent.timeStamp", "error.stack", "domException.stack", "process.exitCode", "performance.timeOrigin", "navigator.hardwareConcurrency", "navigator.userAgent", "navigator.platform", "file.lastModified"]);
  function describe(value) {
    if (value === null || typeof value !== "object" && typeof value !== "function") return typeof value === "string" ? JSON.stringify(value.slice(0, 40)) : String(value);
    return typeof value + " " + Object.prototype.toString.call(value).slice(8, -1);
  }
  const lines = [];
  for (const name of Object.keys(subjects)) {
    let subject;
    try { subject = subjects[name](); } catch (error) { lines.push(name + ": " + (String(error.message).includes("bun compile differs from bun run here") ? "refused" : "throws " + error.name)); continue; }
    const seen = new Set();
    for (let holder = subject; holder !== null && holder !== Object.prototype; holder = Object.getPrototypeOf(holder)) {
      for (const key of Reflect.ownKeys(holder)) {
        if (typeof key === "symbol" || seen.has(key)) continue;
        seen.add(key);
        const descriptor = Reflect.getOwnPropertyDescriptor(holder, key);
        if (!descriptor.get) continue;
        let line;
        try { const value = subject[key]; line = unstable.has(name + "." + key) ? typeof value : describe(value); } catch (error) { line = String(error.message).includes("bun compile differs from bun run here") ? "refused" : "throws " + error.name; }
        lines.push(name + "." + key + ": " + line);
      }
    }
  }
  return lines.join("\\n");
})()`;
console.log((0, eval)(text + (process.argv[9] ?? "")));
/* Output:
buffer: refused
url.href: "https://user:word@example.com:8080/a/b?x"
url.origin: "https://example.com:8080"
url.protocol: "https:"
url.username: "user"
url.password: "word"
url.host: "example.com:8080"
url.hostname: "example.com"
url.port: "8080"
url.pathname: "/a/b"
url.hash: "#h"
url.search: "?x=1"
url.searchParams: object URLSearchParams
searchParams.length: 2
searchParams.size: 2
headers.count: 1
request.body: object ReadableStream
request.bodyUsed: false
request.cache: "default"
request.credentials: "include"
request.destination: ""
request.headers: object Headers
request.integrity: ""
request.method: "POST"
request.mode: "cors"
request.redirect: "follow"
request.referrer: ""
request.referrerPolicy: ""
request.signal: object AbortSignal
request.url: "https://example.com/x"
response.body: object ReadableStream
response.bodyUsed: false
response.headers: object Headers
response.ok: true
response.redirected: false
response.status: 201
response.statusText: ""
response.type: "default"
response.url: ""
blob.lastModified: 4503599627370495
blob.name: undefined
blob.size: 3
blob.type: ""
process._eval: undefined
process.connected: false
process.debugPort: number
process.exitCode: undefined
process.ppid: number
process.title: string
readable: refused
writable: refused
duplex: refused
transform: refused
passThrough: refused
abortController.signal: object AbortSignal
event.isTrusted: false
event.type: "x"
event.target: null
event.currentTarget: null
event.eventPhase: 0
event.cancelBubble: false
event.bubbles: false
event.cancelable: false
event.defaultPrevented: false
event.composed: false
event.timeStamp: number
event.srcElement: null
event.returnValue: true
textDecoder.encoding: "utf-8"
textDecoder.fatal: false
textDecoder.ignoreBOM: false
map.size: 1
typedArray.buffer: object ArrayBuffer
typedArray.byteLength: 3
typedArray.byteOffset: 0
typedArray.length: 3
regExp.global: true
regExp.dotAll: false
regExp.hasIndices: false
regExp.ignoreCase: true
regExp.multiline: false
regExp.sticky: false
regExp.unicode: false
regExp.unicodeSets: false
regExp.source: "a"
regExp.flags: "gi"
arrayBuffer.byteLength: 8
arrayBuffer.resizable: false
arrayBuffer.maxByteLength: 8
arrayBuffer.detached: false
dataView.buffer: object ArrayBuffer
dataView.byteOffset: 2
dataView.byteLength: 6
set.size: 1
symbol.description: "x"
readableStream.locked: false
reader.closed: object Promise
writableStream.locked: false
writer.closed: object Promise
writer.desiredSize: 1
writer.ready: object Promise
transformStream.readable: object ReadableStream
transformStream.writable: object WritableStream
file.lastModified: number
file.name: "/nothing-there.txt"
file.size: 0
file.type: "text/plain;charset=utf-8"
formData.length: 0
port.onmessage: null
port.onmessageerror: null
performance.timeOrigin: number
performance.timing: object PerformanceTiming
performance.onresourcetimingbufferfull: null
navigator.userAgent: string
navigator.platform: string
navigator.hardwareConcurrency: number
customEvent.isTrusted: false
customEvent.detail: 1
customEvent.type: "x"
customEvent.target: null
customEvent.currentTarget: null
customEvent.eventPhase: 0
customEvent.cancelBubble: false
customEvent.bubbles: false
customEvent.cancelable: false
customEvent.defaultPrevented: false
customEvent.composed: false
customEvent.timeStamp: number
customEvent.srcElement: null
customEvent.returnValue: true
abortSignal.aborted: true
abortSignal.reason: object DOMException
abortSignal.onabort: null
textEncoder.encoding: "utf-8"
domException.code: 20
domException.name: "AbortError"
domException.message: "m"
eventEmitter: refused
*/

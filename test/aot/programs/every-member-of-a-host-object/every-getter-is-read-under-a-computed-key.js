// Compiled code makes objects of the host and of the library and reads every accessor that it finds on them and above them, each under a key that it has computed.
// Each read answers what plain Bun answers, or throws the error that says what was left out: nobody knows the receiver and nobody knows the key, so the read names no member of the host, and the program lets in no text
// that would. It never answers something else. TODO: Buffer.prototype.parent is refused here.
console.log((function () {
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
  return lines.join("\n");
})());

// A host function that refuses a receiver or an argument says what it got: "received an instance of Stored". To say so it reads
// `constructor.name` off the value, or `Symbol.toStringTag`, or calls `toString`, or the hook of `inspect`. A function that prints or
// converts a value does the same. Nothing in the program names those reads, so a build that leaves out what nobody refers to, or that
// believes that the call runs no code of the program, has to know them all.
// Each scene makes a value (a literal, an instance, an object below a host's prototype with one operand to Object.create or with two ..),
// gives it members that describe it, each of which notes that it ran, and hands it to one host function as receiver or argument. The
// program prints how the call ended, whether the description came through, and what ran. A program has few scenes and is built alone.
// Where the value is a bag of options, the host reads members under names of its own choosing: some scenes give it getters under those.
import type { Random } from "./random";

/** A host class, a method of its prototype, and arguments for the method. */
const receivers: [string, string, string][] = [
  ["Blob", "text", ""],
  ["Blob", "arrayBuffer", ""],
  ["Blob", "slice", "0, 1"],
  ["Blob", "stream", ""],
  ["Response", "text", ""],
  ["Response", "clone", ""],
  ["Request", "clone", ""],
  ["Request", "json", ""],
  ["Headers", "get", `"a"`],
  ["Headers", "append", `"a", "b"`],
  ["URL", "toString", ""],
  ["URL", "toJSON", ""],
  ["URLSearchParams", "get", `"a"`],
  ["URLSearchParams", "toString", ""],
  ["FormData", "get", `"a"`],
  ["EventTarget", "dispatchEvent", `new Event("x")`],
  ["EventTarget", "addEventListener", `"x", () => {}`],
  ["Event", "preventDefault", ""],
  ["AbortController", "abort", ""],
  ["AbortSignal", "throwIfAborted", ""],
  ["TextDecoder", "decode", ""],
  ["TextEncoder", "encode", `"a"`],
  ["ReadableStream", "getReader", ""],
  ["ReadableStream", "cancel", ""],
  ["WritableStream", "getWriter", ""],
  ["Buffer", "readUInt8", "0"],
  ["Buffer", "toString", ""],
  ["Bun.Glob", "match", `"a"`],
  ["Bun.CryptoHasher", "update", `"a"`],
  ["Bun.Transpiler", "scan", `""`],
  ["SubtleCrypto", "digest", `"SHA-1", new Uint8Array(1)`],
  ["Crypto", "randomUUID", ""],
  ["Performance", "mark", `"a"`],
  ["Map", "get", "1"],
  ["Set", "has", "1"],
  ["Date", "getTime", ""],
  ["RegExp", "exec", `"a"`],
  ["Promise", "then", ""],
  ["ArrayBuffer", "slice", "0"],
  ["DataView", "getInt8", "0"],
  ["Intl.NumberFormat", "resolvedOptions", ""],
];

/** Calls that take the value `V` as an argument. Those with a module need an import. */
const takers: { call: string; module?: [string, string]; reads?: string[] }[] = [
  { call: "path.join(V)", module: ["path", "node:path"] },
  { call: "path.resolve(V)", module: ["path", "node:path"] },
  { call: `path.basename("a", V)`, module: ["path", "node:path"] },
  { call: "fs.readFileSync(V)", module: ["fs", "node:fs"] },
  { call: "fs.existsSync(V)", module: ["fs", "node:fs"] },
  { call: "fs.statSync(V)", module: ["fs", "node:fs"] },
  { call: `new EventEmitter().on("x", V)`, module: ["EventEmitter", "node:events"] },
  { call: `new EventEmitter().emit(V)`, module: ["EventEmitter", "node:events"] },
  { call: "util.inherits(V, V)", module: ["util", "node:util"] },
  { call: "util.promisify(V)", module: ["util", "node:util"] },
  { call: "util.inspect(V)", module: ["util", "node:util"], reads: ["depth", "extra"] },
  { call: `util.format("%s", V)`, module: ["util", "node:util"] },
  { call: `util.format("%o", V)`, module: ["util", "node:util"] },
  { call: `util.format("%j", V)`, module: ["util", "node:util"] },
  { call: `util.format("%d", V)`, module: ["util", "node:util"] },
  { call: "util.isDeepStrictEqual(V, {})", module: ["util", "node:util"] },
  { call: "assert.strictEqual(V, 1)", module: ["assert", "node:assert"] },
  { call: "assert.deepStrictEqual(V, { other: 2 })", module: ["assert", "node:assert"] },
  { call: "assert.ok(false, V)", module: ["assert", "node:assert"] },
  { call: "assert.throws(V)", module: ["assert", "node:assert"] },
  { call: "nodeCrypto.randomBytes(V)", module: ["nodeCrypto", "node:crypto"] },
  { call: "nodeCrypto.createHash(V)", module: ["nodeCrypto", "node:crypto"] },
  { call: `nodeCrypto.createHash("sha1").update(V)`, module: ["nodeCrypto", "node:crypto"] },
  { call: "zlib.gzipSync(V)", module: ["zlib", "node:zlib"] },
  { call: "url.fileURLToPath(V)", module: ["url", "node:url"] },
  { call: "url.parse(V)", module: ["url", "node:url"] },
  { call: "querystring.stringify(V)", module: ["querystring", "node:querystring"], reads: ["a", "extra"] },
  { call: "querystring.escape(V)", module: ["querystring", "node:querystring"] },
  { call: "new StringDecoder(V)", module: ["{ StringDecoder }", "node:string_decoder"] },
  { call: "Buffer.alloc(V)" },
  { call: "Buffer.from(V)" },
  { call: `Buffer.from("a", V)` },
  { call: "Buffer.byteLength(V)" },
  { call: "Buffer.concat(V)" },
  { call: "Buffer.concat([V])" },
  { call: "Buffer.compare(V, V)" },
  { call: "Buffer.alloc(2).fill(V)" },
  { call: "Buffer.alloc(2).write(V)" },
  { call: "Buffer.alloc(2).equals(V)" },
  { call: "clearTimeout(setTimeout(V, 1))" },
  { call: "clearImmediate(setImmediate(V))" },
  { call: "process.nextTick(V)" },
  { call: "queueMicrotask(V)" },
  { call: "process.hrtime(V)" },
  { call: "process.kill(V)" },
  { call: "process.chdir(V)" },
  { call: "new URL(V)" },
  { call: `new URL("/a", V)` },
  { call: "URL.canParse(V)" },
  { call: "new URLSearchParams(V)", reads: ["a", "extra"] },
  { call: "new Request(V)" },
  { call: `new Request("http://a.test/", V)`, reads: ["method", "headers", "body", "signal", "redirect", "keepalive", "duplex"] },
  { call: "new Response(V)" },
  { call: `new Response("", V)`, reads: ["status", "statusText", "headers"] },
  { call: "Response.json(V)", reads: ["extra", "more"] },
  { call: "Response.redirect(V)" },
  { call: "new Headers(V)", reads: ["accept", "extra"] },
  { call: "new Headers([V])" },
  { call: "new Blob(V)" },
  { call: "new Blob([V])" },
  { call: `new Blob([], V)`, reads: ["type", "endings"] },
  { call: `new File([V], V)` },
  { call: "new Event(V)" },
  { call: `new Event("x", V)`, reads: ["bubbles", "cancelable", "composed"] },
  { call: `new CustomEvent("x", V)`, reads: ["detail", "bubbles", "cancelable"] },
  { call: "new EventTarget().dispatchEvent(V)" },
  { call: `new EventTarget().addEventListener("x", V, V)`, reads: ["handleEvent", "once", "passive", "capture", "signal"] },
  { call: "AbortSignal.timeout(V)" },
  { call: "AbortSignal.any(V)" },
  { call: "AbortSignal.any([V])" },
  { call: "atob(V)" },
  { call: "btoa(V)" },
  { call: "structuredClone(V)", reads: ["extra", "more"] },
  { call: "structuredClone(1, V)", reads: ["transfer"] },
  { call: "new TextDecoder(V)" },
  { call: `new TextDecoder("utf-8", V)`, reads: ["fatal", "ignoreBOM"] },
  { call: "new TextDecoder().decode(V)" },
  { call: "new TextEncoder().encode(V)" },
  { call: "new TextEncoder().encodeInto(V, V)" },
  { call: "new ReadableStream(V)", reads: ["start", "pull", "cancel", "type", "autoAllocateChunkSize"] },
  { call: "new ReadableStream({}, V)", reads: ["highWaterMark", "size"] },
  { call: "new WritableStream(V)", reads: ["start", "write", "close", "abort", "type"] },
  { call: "new DOMException(V, V)" },
  { call: "crypto.getRandomValues(V)" },
  { call: `crypto.subtle.digest(V, new Uint8Array(1))` },
  { call: `crypto.subtle.digest("SHA-1", V)` },
  { call: "performance.mark(V)" },
  { call: "performance.measure(V, V)", reads: ["start", "end", "duration", "detail"] },
  { call: "Bun.file(V)" },
  { call: "Bun.gzipSync(V)" },
  { call: "Bun.gunzipSync(V)" },
  { call: "Bun.hash(V)" },
  { call: "Bun.escapeHTML(V)" },
  { call: "Bun.inspect(V)" },
  { call: "Bun.deepEquals(V, {})", reads: ["extra", "more"] },
  { call: "Bun.deepEquals(V, V, true)" },
  { call: "Bun.stringWidth(V)" },
  { call: "Bun.fileURLToPath(V)" },
  { call: "Bun.pathToFileURL(V)" },
  { call: "Bun.which(V)" },
  { call: "Bun.sleepSync(V)" },
  { call: "Bun.nanoseconds(V)" },
  { call: "Bun.concatArrayBuffers(V)" },
  { call: "Bun.concatArrayBuffers([V])" },
  { call: "Bun.TOML.parse(V)" },
  { call: "Bun.semver.satisfies(V, V)" },
  { call: "new Bun.Glob(V)" },
  { call: "new Bun.CryptoHasher(V)" },
  { call: "new Bun.Transpiler(V)", reads: ["loader", "target", "define", "tsconfig"] },
  { call: "Bun.SHA1.hash(V)" },
  { call: "Bun.password.hashSync(V)" },
  { call: "new ByteLengthQueuingStrategy(V)", reads: ["highWaterMark"] },
  { call: "new CountQueuingStrategy(V)", reads: ["highWaterMark"] },
  { call: `new ErrorEvent("x", V)`, reads: ["error", "filename", "lineno", "colno"] },
  { call: `new MessageEvent("x", V)`, reads: ["data", "origin", "lastEventId", "ports"] },
  { call: `new File([], "a", V)`, reads: ["type", "lastModified", "endings"] },
  { call: "dispatchEvent(V)" },
  { call: "new WritableStream().abort(V)" },
  { call: "new WritableStream().getWriter().write(V)" },
  { call: "new ReadableStream().cancel(V)" },
  { call: "new AbortController().abort(V)" },
  { call: "crypto.subtle.sign(V, V, V)", reads: ["name", "hash"] },
  { call: "crypto.subtle.verify(V, V, V, V)", reads: ["name", "hash"] },
  { call: "crypto.subtle.importKey(V, V, V, false, V)", reads: ["name", "hash", "length"] },
  { call: "nodeBuffer.isAscii(V)", module: ["nodeBuffer", "node:buffer"] },
  { call: "nodeBuffer.isUtf8(V)", module: ["nodeBuffer", "node:buffer"] },
  { call: `nodeBuffer.transcode(V, "utf8", "latin1")`, module: ["nodeBuffer", "node:buffer"] },
  { call: "nodeBuffer.resolveObjectURL(V)", module: ["nodeBuffer", "node:buffer"] },
  { call: "vm.isContext(V)", module: ["vm", "node:vm"] },
  { call: "nodeCrypto.createHmac(V, V)", module: ["nodeCrypto", "node:crypto"] },
  { call: `nodeCrypto.createHmac("sha1", V)`, module: ["nodeCrypto", "node:crypto"] },
  { call: "nodeCrypto.createSign(V)", module: ["nodeCrypto", "node:crypto"] },
  { call: "nodeCrypto.createECDH(V)", module: ["nodeCrypto", "node:crypto"] },
  { call: "nodeCrypto.timingSafeEqual(V, V)", module: ["nodeCrypto", "node:crypto"] },
  { call: "JSON.stringify(V)", reads: ["extra", "more"] },
  { call: "JSON.stringify({ in: V })" },
  { call: "JSON.stringify(1, V)" },
  { call: "JSON.parse(V)" },
  { call: "String(V)" },
  { call: "`${V}`" },
  { call: `V + ""` },
  { call: "Number(V)" },
  { call: "BigInt(V)" },
  { call: "Symbol(V)" },
  { call: "new Error(V)" },
  { call: `new Error("m", V)`, reads: ["cause"] },
  { call: "new AggregateError(V)" },
  { call: "Object.prototype.toString.call(V)" },
  { call: "Error.prototype.toString.call(V)" },
  { call: "Function.prototype.toString.call(V)" },
  { call: "new Intl.NumberFormat(V)" },
  { call: `new Intl.NumberFormat("en", V)`, reads: ["style", "currency", "minimumFractionDigits", "notation", "localeMatcher"] },
  { call: `"a".localeCompare("b", V)` },
  { call: `"a".normalize(V)` },
  { call: `"a".repeat(V)` },
  { call: "new Array(V).length" },
  { call: "new Uint8Array(V)" },
  { call: "new ArrayBuffer(V)" },
  { call: "new DataView(V)" },
  { call: "new Map(V)" },
  { call: "new Set(V)" },
  { call: "new WeakMap([[V, 1]]).has(V)" },
  { call: "new Date(V).getTime()" },
  { call: "new RegExp(V)" },
  { call: "Promise.all(V)" },
  { call: "Promise.resolve(V)" },
  { call: "Object.fromEntries(V)", reads: ["0", "length"] },
  { call: "Array.from(V)", reads: ["0", "length"] },
  { call: "Reflect.construct(V, [])" },
  { call: "Reflect.apply(V, null, [])" },
  { call: "new Proxy(V, V)", reads: ["get", "has"] },
  { call: "V instanceof Blob" },
  { call: "Object(1) instanceof V" },
  { call: `"a" in V` },
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const any = (expression: string) => (typed ? `(${expression} as any)` : expression);
  const imports = new Map<string, string>();
  const body: string[] = [];

  const scenes = random.weighted([
    [5, 1],
    [3, 2],
    [1, 3],
  ]);
  for (let scene = 1; scene <= scenes; scene++) {
    const value = `v${scene}`;
    const described = `Described${scene}`;
    const ran = (what: string) => `ran.push("${what} ${scene}");`;
    const asReceiver = random.chance(0.4);
    const taker = random.chance(0.35) ? random.pick(takers.filter(each => each.reads)) : random.pick(takers);
    const [host, method, operands] = random.pick(receivers);
    const above = asReceiver || random.chance(0.3) ? `${host}.prototype` : random.pick(["Object.prototype", "null", "Array.prototype", "Function.prototype", "Error.prototype"]);

    // What describes the value. Each is a member of the value, or of what its `constructor` answers.
    const namer = random.pick([
      `{ get name() { ${ran("name")} return "${described}"; } }`,
      `{ get name() { ${ran("name")} return "${described}"; } }`,
      `{ name: "${described}" }`,
      `class { static get name() { ${ran("name")} return "${described}"; } }`,
      `function ${described}() {}`,
      `Object.defineProperty(function () {}, "name", { get() { ${ran("name")} return "${described}"; } })`,
    ]);
    const members: [number, string, string][] = [
      [6, "constructor", `value: ${namer}, writable: true, configurable: true`],
      [3, "constructor", `get() { ${ran("constructor")} return ${namer}; }, configurable: true`],
      [3, "[Symbol.toStringTag]", `get() { ${ran("tag")} return "${described}"; }, configurable: true`],
      [2, "toString", `value() { ${ran("toString")} return "${described}"; }, writable: true, configurable: true`],
      [1, "valueOf", `value() { ${ran("valueOf")} return "${described}"; }, writable: true, configurable: true`],
      [2, "[Symbol.toPrimitive]", `value() { ${ran("toPrimitive")} return "${described}"; }, configurable: true`],
      [2, `[Symbol.for("nodejs.util.inspect.custom")]`, `value() { ${ran("inspect")} return "${described}"; }, configurable: true`],
      [1, "toJSON", `value() { ${ran("toJSON")} return "${described}"; }, writable: true, configurable: true`],
      [1, "name", `get() { ${ran("own name")} return "${described}"; }, configurable: true, enumerable: true`],
      [1, "message", `get() { ${ran("message")} return "${described}"; }, configurable: true, enumerable: true`],
      [1, "length", `get() { ${ran("length")} return 1; }, configurable: true`],
      [1, "then", `get() { ${ran("then")} return undefined; }, configurable: true`],
      [1, "[Symbol.iterator]", `value() { ${ran("iterator")} return [][Symbol.iterator](); }, configurable: true`],
    ];
    const chosen = new Map<string, string>();
    if (!asReceiver && taker.reads && random.chance(0.8))
      for (const name of random.sample(taker.reads, random.between(1, 3)))
        chosen.set(/^\d/.test(name) ? `[${name}]` : name, `get() { ${ran(name)} return undefined; }, configurable: true, enumerable: ${random.chance(0.7)}`);
    for (let count = random.weighted([[5, 1], [3, 2], [1, 3]]); count > 0; count--) {
      const [, key, descriptor] = random.weighted(members.map(member => [member[0], member] as const));
      chosen.set(key, descriptor);
    }
    const keyOf = (key: string) => (key.startsWith("[") ? key.slice(1, -1) : JSON.stringify(key));
    const inMap = [...chosen].map(([key, descriptor]) => `${key}: { ${descriptor} }`).join(", ");
    const later = (): string[] =>
      [...chosen].map(([key, descriptor]) =>
        descriptor.startsWith("value: ") && random.chance(0.5)
          ? `${value}${key.startsWith("[") ? key : "." + key} = ${descriptor.slice("value: ".length, descriptor.indexOf(", writable"))};`
          : `Object.defineProperty(${value}, ${keyOf(key)}, { ${descriptor} });`,
      );

    const made = random.weighted<string[]>([
      [4, [`const ${value}${as("any")} = Object.create(${above}, { other: { value: 1 } });`, ...later()]],
      [2, [`const ${value}${as("any")} = Object.create(${above}, {});`, ...later()]],
      [3, [`const ${value}${as("any")} = Object.create(${above});`, ...later()]],
      [3, [`const ${value}${as("any")} = Object.create(${above}, { ${inMap} });`]],
      [2, [`const ${value}${as("any")} = { __proto__: ${above}, other: 1 };`, ...later()]],
      [2, [`const ${value}${as("any")} = Object.setPrototypeOf({ other: 1 }, ${above});`, ...later()]],
      [2, [`const ${value}${as("any")} = Object.defineProperties({ other: 1 }, { ${inMap} });`]],
      [2, [`class Made${scene} { other = 1; }`, `const ${value}${as("any")} = new Made${scene}();`, ...later()]],
      [1, [`const ${value}${as("any")} = function () {};`, ...later()]],
      // The length of a list cannot be defined anew.
      [1, [`const ${value}${as("any")} = [1];`, ...later().filter(line => !line.includes(`"length"`))]],
      [1, [`const ${value}${as("any")} = new Error("made");`, ...later()]],
    ]);

    let call: string;
    if (asReceiver)
      call = random.chance(0.5) ? `${value}.${method}(${operands})` : `${any(`${host}.prototype`)}.${method}.call(${[value, operands].filter(Boolean).join(", ")})`;
    else {
      if (taker.module) imports.set(taker.module[0], taker.module[1]);
      call = taker.call.replaceAll(/\bV\b/g, value);
    }
    const inFunction = random.chance(0.5);
    body.push(
      ...made,
      ...(inFunction ? [`function ask${scene}() { return ${call}; }`] : []),
      `console.log("s${scene}", await told(() => ${inFunction ? `ask${scene}()` : call}, "${described}"), ran.splice(0).join());`,
    );
  }

  return [
    ...[...imports].map(([name, module]) => `import ${name} from "${module}";`),
    `const ran${as("string[]")} = [];`,
    `async function told(f${as("() => any")}, described${as("string")})${as("Promise<string>")} {`,
    `  const says = (v${as("any")}) => { try { return String(v).includes(described) ? "described" : "not described"; } catch { return "not a text"; } };`,
    `  try { const v = await f(); return "answers " + typeof v + " " + says(v); } catch (e${as("any")}) { return "throws " + e?.name + " " + e?.code + " " + says(e); }`,
    `}`,
    ...body,
    "export {};",
  ].join("\n");
}

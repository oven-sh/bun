// Small programs that make one object of a built-in module and go through every key that it and the objects above it list, symbols too, with the key as a value (`corners`: the object and who is asked).
//
//   the object  (`makers`) what bun:sqlite, node:events, node:stream, node:net, node:http, node:fs, node:zlib, node:crypto, node:readline, node:child_process, node:worker_threads, node:async_hooks, node:dns,
//               node:diagnostics_channel, node:util, node:url, node:test, node:assert, node:perf_hooks, node:v8, node:tls, node:dgram, undici, the streams of the web and others make
//   who is      (`asked`) the object, an heir of it (`Object.create`), an heir of an heir, an object that gets it as its prototype later, a proxy without and with traps, `Reflect.get` with a receiver (a literal, an heir,
//   asked       a number, an object of another class), each object above it for itself, an object that has the prototype and was never constructed, `super` in a literal below it, the getter out of the descriptor
//               called on an heir, a store under every key that has a setter, every function called on an heir or on a literal
//   the look    a read, a read in a chain, a pattern, the kind, `in`, with a fallback
//   ahead       nothing, or a few members are asked of the object by names out of a list
//   the files   one, or the maker, the keys and the looks in files of their own; JavaScript, or TypeScript over a declaration file that says something else about the object
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

/** What it imports ("Database bun:sqlite"), and the statements of a function that end by returning the object. `c`: its functions are called too. */
type Maker = readonly [takes: string, make: string, more?: string];

const socket = "new Socket()";
export const makers: Record<string, Maker> = {
  "a database": ["Database bun:sqlite", 'return new Database(":memory:");', "c"],
  "a statement of a database": ["Database bun:sqlite", 'return new Database(":memory:").query("select 1 as a");', "c"],
  "a prepared statement of a database": [
    "Database bun:sqlite",
    'return new Database(":memory:").prepare("select ? as a");',
    "c",
  ],
  "an emitter": ["EventEmitter node:events", "return new EventEmitter();", "c"],
  "an emitter that captures rejections": [
    "EventEmitter node:events",
    "return new EventEmitter({ captureRejections: true });",
    "c",
  ],
  "an emitter that is an asynchronous resource": [
    "EventEmitterAsyncResource node:events",
    "return new EventEmitterAsyncResource();",
    "c",
  ],
  "a stream to read from": ["Readable node:stream", "return new Readable({ read() {} });"],
  "a stream to write to": [
    "Writable node:stream",
    "return new Writable({ write(chunk, encoding, done) {\n  done();\n} });",
  ],
  "a stream in both directions": [
    "Duplex node:stream",
    "return new Duplex({ read() {}, write(chunk, encoding, done) {\n  done();\n} });",
  ],
  "a stream that changes what passes": ["Transform node:stream", "return new Transform();"],
  "a stream that passes everything on": ["PassThrough node:stream", "return new PassThrough();"],
  "one side of a pair of streams": ["duplexPair node:stream", "return duplexPair()[0];", "c"],
  "a stream out of a list": ["Readable node:stream", "return Readable.from([1, 2]);"],
  "a socket": ["Socket node:net", `return ${socket};`],
  "a server of sockets": ["createServer node:net", "return createServer();"],
  "a list of blocked addresses": ["BlockList node:net", "return new BlockList();", "c"],
  "the address of a socket": [
    "SocketAddress node:net",
    'return new SocketAddress({ address: "1.2.3.4", port: 80 });',
    "c",
  ],
  "a server of node:http": ["createServer node:http", "return createServer();"],
  "a request that came in": ["IncomingMessage node:http, Socket node:net", `return new IncomingMessage(${socket});`],
  "a response made by hand": [
    "IncomingMessage node:http, ServerResponse node:http, Socket node:net",
    `return new ServerResponse(new IncomingMessage(${socket}));`,
  ],
  "a message that goes out": ["OutgoingMessage node:http", "return new OutgoingMessage();"],
  "an agent of node:http": ["Agent node:http", "return new Agent();"],
  "an agent of node:https": ["Agent node:https", "return new Agent();"],
  "a server of node:http2": ["createServer node:http2", "return createServer();"],
  "an open folder": ["opendirSync node:fs", 'return opendirSync(".");', "c"],
  "what is known about a folder": ["statSync node:fs", 'return statSync(".");'],
  "an entry of a folder": ["readdirSync node:fs", 'return readdirSync("/", { withFileTypes: true })[0];'],
  "a stream out of a file": [
    "createReadStream node:fs",
    "return createReadStream(process.execPath, { start: 0, end: 3 });",
  ],
  "a file handle": ["open node:fs/promises", 'return await open(process.execPath, "r");', "c"],
  "a watcher of a folder": ["watch node:fs", 'return watch(".");'],
  "a stream that packs": ["createGzip node:zlib", "return createGzip();"],
  "a stream that unpacks": ["createInflate node:zlib", "return createInflate();"],
  "a stream that packs by brotli": ["createBrotliCompress node:zlib", "return createBrotliCompress();"],
  "a stream that packs by zstd": ["createZstdCompress node:zlib", "return createZstdCompress();"],
  "a hash": ["createHash node:crypto", 'return createHash("sha256");'],
  "a keyed hash": ["createHmac node:crypto", 'return createHmac("sha256", "key");'],
  "a cipher": [
    "createCipheriv node:crypto",
    'return createCipheriv("aes-128-gcm", Buffer.alloc(16), Buffer.alloc(12));',
  ],
  "a signer": ["createSign node:crypto", 'return createSign("sha256");'],
  "an exchange of keys over a curve": ["createECDH node:crypto", 'return createECDH("prime256v1");'],
  "a secret key": ["createSecretKey node:crypto", 'return createSecretKey(Buffer.from("0123456789abcdef"));', "c"],
  "an interface that reads lines": [
    "createInterface node:readline, PassThrough node:stream",
    "return createInterface({ input: new PassThrough() });",
  ],
  "an interface that reads lines and answers promises": [
    "createInterface node:readline/promises, PassThrough node:stream",
    "return createInterface({ input: new PassThrough() });",
  ],
  "what writes to a terminal in one go": [
    "Readline node:readline/promises, PassThrough node:stream",
    "return new Readline(new PassThrough());",
    "c",
  ],
  "a child process that was never started": ["ChildProcess node:child_process", "return new ChildProcess();", "c"],
  "a port": ["MessageChannel node:worker_threads", "return new MessageChannel().port1;"],
  "a channel of ports": ["MessageChannel node:worker_threads", "return new MessageChannel();"],
  "a store that follows asynchronous calls": [
    "AsyncLocalStorage node:async_hooks",
    "return new AsyncLocalStorage();",
    "c",
  ],
  "an asynchronous resource": ["AsyncResource node:async_hooks", 'return new AsyncResource("kind");', "c"],
  "a resolver of names": ["Resolver node:dns", "return new Resolver();", "c"],
  "a resolver of names that answers promises": ["Resolver node:dns/promises", "return new Resolver();", "c"],
  "a channel of diagnostics": ["channel node:diagnostics_channel", 'return channel("handed");', "c"],
  "a channel of diagnostics that somebody hears": [
    "channel node:diagnostics_channel",
    'const it = channel("heard");\nit.subscribe(() => {});\nreturn it;',
    "c",
  ],
  "a channel that traces": ["tracingChannel node:diagnostics_channel", 'return tracingChannel("traced");', "c"],
  "a kind of content": ["MIMEType node:util", 'return new MIMEType("text/plain; charset=utf-8");', "c"],
  "the parameters of a kind of content": ["MIMEParams node:util", "return new MIMEParams();", "c"],
  "a decoder of node:util": ["TextDecoder node:util", "return new TextDecoder();"],
  "a decoder of bytes that come in parts": [
    "StringDecoder node:string_decoder",
    'return new StringDecoder("utf8");',
    "c",
  ],
  "an address parsed the old way": ["parse node:url", 'return parse("http://user@example.com:8080/a?b=1#c");', "c"],
  "an address": ["URL node:url", 'return new URL("http://example.com/a?b=1");'],
  "a function that is watched": ["mock node:test", "return mock.fn(() => 1);"],
  "what a watched function remembers": ["mock node:test", "return mock.fn(() => 1).mock;", "c"],
  "the timers of node:test": ["mock node:test", "return mock.timers;"],
  "what keeps track of calls": ["CallTracker node:assert", "return new CallTracker();", "c"],
  "an assertion that failed": [
    "AssertionError node:assert",
    'return new AssertionError({ message: "no", actual: 1, expected: 2, operator: "strictEqual" });',
  ],
  "a histogram": ["createHistogram node:perf_hooks", "return createHistogram();", "c"],
  "an observer of performance": ["PerformanceObserver node:perf_hooks", "return new PerformanceObserver(() => {});"],
  "a mark of performance": ["performance node:perf_hooks", 'return performance.mark("here");'],
  "a serializer": ["Serializer node:v8", "return new Serializer();"],
  "a deserializer": ["Deserializer node:v8", "return new Deserializer(Buffer.from([255, 15]));"],
  "a context of node:tls": ["createSecureContext node:tls", "return createSecureContext();"],
  "a socket of node:tls": ["TLSSocket node:tls, Socket node:net", `return new TLSSocket(${socket});`],
  "a server of node:tls": ["createServer node:tls", "return createServer();"],
  "a socket of datagrams": ["createSocket node:dgram", 'return createSocket("udp4");'],
  "a console of its own": ["Console node:console, PassThrough node:stream", "return new Console(new PassThrough());"],
  "a domain": ["create node:domain", "return create();"],
  "a module": ["Module node:module", 'return new Module("handed");'],
  "a session of the inspector": ["Session node:inspector", "return new Session();", "c"],
  "what traces events": ["createTracing node:trace_events", 'return createTracing({ categories: ["node"] });', "c"],
  "a timer": ["", "return setTimeout(() => {}, 1);"],
  "an immediate": ["", "return setImmediate(() => {});"],
  "the output of the process": ["", "return process.stdout;"],
  "an agent of undici": ["Agent undici", "return new Agent();", "c"],
  "a pool of undici": ["Pool undici", 'return new Pool("http://localhost:1");', "c"],
  "an agent of undici that answers by itself": ["MockAgent undici", "return new MockAgent();", "c"],
  "a reader of files of undici": ["FileReader undici", "return new FileReader();", "c"],
  "a stream of the web to read from": ["", "return new ReadableStream({});", "c"],
  "the reader of a stream of the web": ["", "return new ReadableStream({}).getReader();", "c"],
  "the reader of bytes of a stream of the web": [
    "",
    'return new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" });',
    "c",
  ],
  "a stream of the web to write to": ["", "return new WritableStream({});", "c"],
  "the writer of a stream of the web": ["", "return new WritableStream({}).getWriter();", "c"],
  "a stream of the web that changes what passes": ["", "return new TransformStream();", "c"],
  "a strategy that counts": ["", "return new CountQueuingStrategy({ highWaterMark: 1 });", "c"],
  "a strategy that counts bytes": ["", "return new ByteLengthQueuingStrategy({ highWaterMark: 1 });", "c"],
  "a stream that decodes texts": ["", "return new TextDecoderStream();", "c"],
  "a stream that encodes texts": ["", "return new TextEncoderStream();", "c"],
  "a stream of the web that packs": ["", 'return new CompressionStream("gzip");', "c"],
  "the body of a response": ["", 'return new Response("body").body;', "c"],
  "a command of the shell that was not started": ["", "return Bun.$`echo handed`.quiet();"],
  "a shell of its own": ["", "return new Bun.$.Shell();"],
};

/** `§` is the object, `¤` the key, `°` the object above it that lists the key. Ahead of the loop stands `holder`, which may define `asked`. */
type Asked = readonly [holder: string, look: string, only?: "getters" | "setters" | "functions"];
export const asked: Record<string, Asked> = {
  "the object": ["const asked = §;", "LOOK"],
  "an heir": ["const asked = Object.create(§);", "LOOK"],
  "an heir of an heir": ["const asked = Object.create(Object.create(§));", "LOOK"],
  "an object that gets it as its prototype later": ["const asked = Object.setPrototypeOf({ own: 1 }, §);", "LOOK"],
  "a frozen heir": ["const asked = Object.freeze(Object.create(§));", "LOOK"],
  "a proxy": ["const asked = new Proxy(§, {});", "LOOK"],
  "a proxy whose trap hands on": [
    "const asked = new Proxy(§, {\n  get(target, key, receiver) {\n    return Reflect.get(target, key, receiver);\n  },\n});",
    "LOOK",
  ],
  "a proxy of an heir": ["const asked = new Proxy(Object.create(§), {});", "LOOK"],
  "an heir of a proxy": ["const asked = Object.create(new Proxy(§, {}));", "LOOK"],
  "Reflect.get with a literal as the receiver": ["const asked = {};", "Reflect.get(§, ¤, asked)"],
  "Reflect.get with an heir as the receiver": ["const asked = Object.create(§);", "Reflect.get(§, ¤, asked)"],
  "Reflect.get with a number as the receiver": ["const asked = 5;", "Reflect.get(§, ¤, asked)"],
  "Reflect.get with an object of another class as the receiver": [
    "const asked = new Map();",
    "Reflect.get(§, ¤, asked)",
  ],
  "each object above it for itself": ["const asked = null;", "°[¤]"],
  "an object that has the prototype and was never constructed": [
    "const asked = Object.create(Object.getPrototypeOf(§));",
    "LOOK",
  ],
  "super in a literal below it": [
    "const asked = {\n  __proto__: §,\n  look(key) {\n    return super[key];\n  },\n};",
    "asked.look(¤)",
  ],
  "the getter out of the descriptor, called on an heir": [
    "const asked = Object.create(§);",
    "getterOf(°, ¤).call(asked)",
    "getters",
  ],
  "the getter out of the descriptor, called on a literal": [
    "const asked = {};",
    "Reflect.apply(getterOf(°, ¤), asked, [])",
    "getters",
  ],
  "a store on an heir under every key that has a setter": [
    "const asked = Object.create(§);",
    "(asked[¤] = 1)",
    "setters",
  ],
  "Reflect.set with a literal as the receiver": ["const asked = {};", "Reflect.set(§, ¤, 1, asked)", "setters"],
  "every function called on an heir": ["const asked = Object.create(§);", "asked[¤]()", "functions"],
  "every function called on a literal": ["const asked = {};", "Reflect.apply(°[¤], asked, [])", "functions"],
};

/** Every object with everybody who is asked; functions are called only where that ends by itself. */
export const corners: string[] = Object.entries(makers).flatMap(([maker, [, , more]]) =>
  Object.entries(asked)
    .filter(([, [, , only]]) => only !== "functions" || more === "c")
    .map(([who]) => `${maker} | ${who}`),
);

const indented = (lines: string, by = "  ") =>
  lines
    .split("\n")
    .map(line => (line ? by + line : line))
    .join("\n");

export function generate(random: Random, corner: string) {
  const [named, who] = corner.split(" | ");
  const [takes, make] = makers[named];
  const [holder, way, only] = asked[who];
  const language = random.weighted([
    [4, "JavaScript"],
    [3, "TypeScript"],
  ] as const);
  const isTyped = language === "TypeScript";
  const isCommonJS = !isTyped && random.chance(0.35);
  const script = isCommonJS ? "cjs" : "mjs";
  const typed = isTyped ? "ts" : script;
  const T = (written: string) => (isTyped ? written : "");
  const split = random.weighted([
    [3, "one file"],
    [2, "the maker apart"],
    [2, "every part apart"],
  ] as const);
  const look =
    way !== "LOOK"
      ? way
      : random.weighted([
          [5, "asked[¤]"],
          [2, "asked?.[¤]"],
          [2, "(({ [¤]: found }) => found)(asked)"],
          [1, "typeof asked[¤]"],
          [1, "¤ in asked"],
          [1, 'asked[¤] ?? "nothing"'],
          [1, "Reflect.get(asked, ¤)"],
        ]);
  const ahead = random.weighted([
    [3, ""],
    [
      3,
      `for (const name of ["close", "filename", "on", "size", "length", "closed"]) {\n  if (typeof it?.[name] === "function") console.log("has", name);\n}\n`,
    ],
    [1, `console.log("listed", Reflect.ownKeys(it).length > 0);\n`],
    [1, `console.log("named", it.constructor?.name);\n`],
  ]);
  const take = (names: string[], from: string, isScript: boolean) =>
    isCommonJS && isScript
      ? `const { ${names.join(", ")} } = require("${from}");\n`
      : `import { ${names.join(", ")} } from "${from}";\n`;
  const modules = new Map<string, string[]>();
  for (const each of takes ? takes.split(", ") : []) {
    const [name, from] = each.split(" ");
    modules.set(from, [...(modules.get(from) ?? []), name]);
  }
  const exported = isCommonJS ? "" : "export ";
  const handsOn = (names: string[]) => (isCommonJS ? names.map(each => `exports.${each} = ${each};\n`).join("") : "");

  const maker =
    [...modules].map(([from, names]) => take(names, from, true)).join("") +
    `${exported}async function make() {\n${indented(make)}\n}\n`;
  const any = T(": any");
  const keys = `${exported}function levels(object${any})${T(": any[]")} {
  const list = [];
  for (let level = object; level !== null && level !== Object.prototype && level !== Function.prototype; level = Object.getPrototypeOf(level)) list.push(level);
  return list;
}
${exported}function getterOf(level${any}, key${T(": PropertyKey")})${any} {
  return Reflect.getOwnPropertyDescriptor(level, key)${T("!")}.get;
}
${exported}function nameOf(key${T(": PropertyKey")})${T(": string")} {
  return typeof key === "symbol" ? "@" + key.description : String(key);
}
`;
  const shows = `${exported}function show(value${any})${T(": string")} {
  if (typeof value === "string") return value.length > 40 || /[\\\\/]/.test(value) ? "a text" : JSON.stringify(value);
  if (typeof value === "symbol") return "@" + value.description;
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "bigint") return "a big integer";
  if (typeof value === "number") return Number.isInteger(value) && Math.abs(value) < 3 ? String(value) : "a number";
  if (typeof value !== "object" || value === null) return String(value);
  if (typeof value.then === "function") {
    value.then(
      () => {},
      () => {},
    );
    return "a promise";
  }
  return Array.isArray(value) ? "a list of " + value.length : "object " + (Object.getPrototypeOf(value)?.constructor?.name ?? "without a prototype");
}
`;
  const wanted =
    only === "getters"
      ? `    if (!Reflect.getOwnPropertyDescriptor(level, key)${T("!")}.get) continue;\n`
      : only === "setters"
        ? `    if (!Reflect.getOwnPropertyDescriptor(level, key)${T("!")}.set) continue;\n`
        : only === "functions"
          ? `    if (typeof Reflect.getOwnPropertyDescriptor(level, key)${T("!")}.value !== "function" || key === "constructor") continue;\n`
          : "";
  const written = look.replaceAll("§", "it").replaceAll("¤", "key").replaceAll("°", "level");
  const looks = `${exported}function go(it${any}) {
${indented(
  holder
    .replaceAll("§", "it")
    .replace("const asked =", `const asked${any} =`)
    .replace("look(key)", `look(key${T(": PropertyKey")})`)
    .replace("get(target, key, receiver)", `get(target${any}, key${any}, receiver${any})`),
)}
  void asked, getterOf;
  for (const level of levels(it)) {
    for (const key of Reflect.ownKeys(level)) {
${wanted}      let saw;
      try {
        saw = show(${written});
      } catch (error) {
        saw = "THROWS " + (error${T(" as Error")})?.name;
      }
      console.log(nameOf(key) + ": " + saw);
    }
  }
  console.log("that is all");
}
`;
  const ends = `for (const name of ["removeAllListeners", "destroy", "close", "unref", "cancel", "abort", "releaseLock"]) {
  try {
    const answer = typeof it?.[name] === "function" ? it[name]() : undefined;
    if (typeof answer?.then === "function")
      answer.then(
        () => {},
        () => {},
      );
  } catch {}
}
`;
  const quiet = `process.on("uncaughtException", error => console.log("nobody caught", error?.name));
process.on("unhandledRejection", error => console.log("nobody handled", error?.name));
`;
  const body = `const it${any} = await make();\ntry {\n  if (typeof it?.on === "function") it.on("error", () => {});\n} catch {}\n${ahead}go(it);\n${ends}`;
  const inside = isCommonJS ? `(async () => {\n${indented(body)}})();\n` : body;
  const files: Record<string, string> = {};
  const from = (file: string, extension: string) => `./${file}${extension === "ts" ? "" : "." + extension}`;
  let text: string;
  const strip = (part: string) =>
    part.replaceAll("export function", "function").replaceAll("export async function", "async function");
  const isMakerApart = split !== "one file" || isTyped;
  if (isMakerApart) {
    files[`makes.${script}`] = maker + handsOn(["make"]);
    if (isTyped)
      files["makes.d.mts"] =
        `export declare function make(): Promise<${random.pick(["any", "object", "{ size: number; close(): void }", "Map<string, number>"])}>;\n`;
  }
  if (split === "every part apart") {
    files[`keys.${typed}`] = keys + handsOn(["levels", "getterOf", "nameOf"]);
    files[`shows.${typed}`] = shows + handsOn(["show"]);
    files[`looks.${typed}`] =
      take(["levels", "getterOf", "nameOf"], from("keys", typed), !isTyped) +
      take(["show"], from("shows", typed), !isTyped) +
      looks +
      handsOn(["go"]);
    text =
      take(["make"], from("makes", script), !isTyped) + take(["go"], from("looks", typed), !isTyped) + quiet + inside;
  } else {
    text =
      (isMakerApart ? take(["make"], from("makes", script), !isTyped) : strip(maker)) +
      strip(keys) +
      strip(shows) +
      strip(looks) +
      quiet +
      inside;
  }
  if (!isCommonJS) text += "export {};\n";
  if (isTyped) {
    files["host.d.ts"] = "declare const process: {\n  on(name: string, listener: (error: Error) => void): void;\n};\n";
    files["tsconfig.json"] =
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: "preserve",
            moduleResolution: "bundler",
            noEmit: true,
            strict: true,
            types: [],
          },
        },
        null,
        2,
      ) + "\n";
  }
  return { file: `main.${typed}`, text, files };
}

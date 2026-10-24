// Without `@types/bun`, TypeScript knows neither `console` nor the module "bun", and `bun check` says so. A build goes on with the
// declarations that Bun brings along. They hold no program to what its project has not installed: where a program does not fit them,
// what Bun provides is of type `any`. The executable does what `bun run` does. Every other type error stops the build as always.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildTimeout = 300_000;

async function build(folder: string) {
  const command = [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "app"];
  const { stderr, exitCode, signal } = await spawned(command, folder, env);
  const lines = stderr.split("\n");
  const codes = (label: string) =>
    lines.flatMap(line => new RegExp(`^${label}: (TS\\d+): `).exec(line)?.[1] ?? []).sort();
  return { errors: codes("error"), warnings: codes("warn"), exitCode, signal };
}

async function check(folder: string, ...flags: string[]) {
  const { stdout, exitCode, signal } = await spawned(
    [bunExe(), "check", ...flags, "--no-pretty", "main.ts"],
    folder,
    env,
  );
  const codes = (label: string) =>
    stdout
      .split("\n")
      .flatMap(line => new RegExp(`^main\\.ts\\(\\d+,\\d+\\): ${label} (TS\\d+): `).exec(line)?.[1] ?? [])
      .sort();
  return { errors: codes("error"), warnings: codes("warning"), exitCode, signal };
}

async function run(folder: string, how: "compiled" | "plain") {
  const command = how === "compiled" ? [join(folder, isWindows ? "app.exe" : "app")] : [bunExe(), "run", "main.ts"];
  const { stdout, exitCode, signal } = await spawned(command, folder, bunEnv);
  return { stdout, exitCode, signal };
}

const built = { errors: [], warnings: [], exitCode: 0, signal: null };

// A class, the arguments for it, and what to print of the instance. `made` is the instance.
const classesToStandBelow: [string, string, string][] = [
  ["Map<number, string>", `[[1, "a"]]`, `made.get(1)`],
  ["Set<number>", `[1]`, `made.has(1)`],
  ["WeakMap<object, number>", `[[globalThis, 1]]`, `made.get(globalThis)`],
  ["Array<number>", `3`, `made.length`],
  ["Error", `"failed"`, `made.message`],
  ["TypeError", `"failed"`, `made.message`],
  ["Promise<number>", `resolve => resolve(6)`, `await made`],
  ["RegExp", `"a+", "g"`, `made.flags`],
  ["Date", `86400000`, `made.getTime()`],
  ["Uint8Array", `4`, `made.length`],
  ["ArrayBuffer", `8`, `made.byteLength`],
  ["DataView<ArrayBuffer>", `new ArrayBuffer(8)`, `made.byteLength`],
  ["String", `"text"`, `made.length`],
  ["Number", `12`, `made.valueOf()`],
  ["Boolean", `true`, `made.valueOf()`],
  ["Event", `"e"`, `made.type`],
  ["CustomEvent", `"e", { detail: 1 }`, `made.detail`],
  ["MessageEvent", `"m", { data: 1 }`, `made.data`],
  ["ErrorEvent", `"x", { message: "went wrong" }`, `made.message`],
  ["CloseEvent", `"c", { code: 1001 }`, `made.code`],
  ["EventTarget", ``, `typeof made.dispatchEvent`],
  ["URL", `"http://host/path"`, `made.pathname`],
  ["URLSearchParams", `"a=1"`, `made.get("a")`],
  ["Headers", `{ a: "1" }`, `made.get("a")`],
  ["Blob", `["abc"]`, `made.size`],
  ["File", `["abc"], "f.txt"`, `made.name`],
  ["Request", `"http://host/"`, `made.url`],
  ["Response", `"body"`, `await made.text()`],
  ["FormData", ``, `[...made.keys()].length`],
  ["TextDecoder", `"utf-16le"`, `made.encoding`],
  ["TextEncoder", ``, `made.encoding`],
  ["ReadableStream", `{ start(controller: any) { controller.close(); } }`, `made.locked`],
  ["WritableStream", `{}`, `made.locked`],
  ["TransformStream", `{}`, `made.readable.locked`],
  ["BroadcastChannel", `"c"`, `(made.close(), made.name)`],
  ["AbortController", ``, `made.signal.aborted`],
  ["DOMException", `"m", "n"`, `made.name`],
  ["Buffer", `4`, `made.length`],
];

// These two reach outside the program as soon as they are made.
const classesNotToMake: [string, string][] = [
  ["Worker", `"./worker.ts"`],
  ["WebSocket", `"ws://localhost/"`],
];

const nameOf = (base: string) => base.replace(/<.*/, "");

const oneClassBelowEach =
  classesToStandBelow
    .map(
      ([base, given, shown]) =>
        `{\n  class Below extends ${base} {}\n  const made = new Below(${given});\n  console.log("${nameOf(base)}", made instanceof ${nameOf(base)}, ${shown});\n}\n`,
    )
    .join("") +
  classesNotToMake
    .map(
      ([base, given]) =>
        `{\n  class Below extends ${base} {}\n  if (process.argv.includes("--reach-outside")) new Below(${given});\n  console.log("${base}", Object.getPrototypeOf(Below) === ${base});\n}\n`,
    )
    .join("");

// What a program may use without a declaration, and the errors of `bun check` that a build does not repeat.
const provided: Record<
  string,
  { files: Record<string, string>; checkSays: string[]; warnings?: string[]; prints: string }
> = {
  "console": { files: { "main.ts": `console.log("ran");\n` }, checkSays: ["TS2584"], prints: "ran\n" },
  "the module bun": {
    files: { "main.ts": `import { version } from "bun";\nconsole.log(typeof version);\n` },
    checkSays: ["TS2307", "TS2584"],
    prints: "string\n",
  },
  "globals of Bun, of Node.js and of the web, as values and as types": {
    files: {
      "main.ts": `const response: Response = new Response("body");
const url: URL = new URL("https://example.com/path");
const timer: Timer = setTimeout(() => {}, 1000);
clearTimeout(timer);
const interval: NodeJS.Timeout = setInterval(() => {}, 1000);
clearInterval(interval);
console.log(typeof Bun.version, typeof process.argv, Buffer.from("a").length, await response.text(), url.pathname, typeof fetch, new TextEncoder().encode("ab").length, typeof structuredClone, typeof performance.now());
`,
    },
    checkSays: [],
    prints: "string object 1 body /path function 2 function number\n",
  },
  "what every module is given": {
    files: {
      "main.ts": `const path = require("node:path");\nconsole.log(path.basename(__filename), typeof __dirname, typeof module, typeof exports, typeof import.meta.dir, import.meta.main);\n`,
    },
    checkSays: [],
    prints: "main.ts string object object string true\n",
  },
  "modules of Bun and of Node.js": {
    files: {
      "main.ts": `import { basename } from "node:path";
import os from "os";
import { Database } from "bun:sqlite";
import type { Server } from "bun";
const server: Server | undefined = undefined;
console.log(basename("/a/b.txt"), typeof os.cpus, typeof Database, server);
`,
    },
    checkSays: [],
    prints: "b.txt function function undefined\n",
  },
  "files that only Bun's declarations give a type": {
    files: {
      "main.ts": `import text from "./note.txt";\nimport settings from "./settings.toml";\nimport untyped from "./untyped.js";\nconsole.log(text.trim(), settings.n, untyped);\n`,
      "note.txt": "note\n",
      "settings.toml": "n = 1\n",
      "untyped.js": `export default "untyped";\n`,
    },
    checkSays: [],
    prints: "note 1 untyped\n",
  },
  "a file whose name has a quote in it": {
    files: {
      "main.ts": `import text from "./it's a note.txt";\nconsole.log(text.trim());\n`,
      "it's a note.txt": "note\n",
    },
    checkSays: [],
    prints: "note\n",
  },
  "members of Bun and of import.meta, by destructuring and in types": {
    files: {
      "main.ts": `const { version } = Bun;
const { dir } = import.meta;
type Directory = ImportMeta["dir"];
const directory: Directory = dir;
const server: Bun.Server | undefined = undefined;
const other: import("bun").Server | undefined = undefined;
console.log(typeof version, typeof directory, server, other);
`,
    },
    checkSays: [],
    prints: "string string undefined undefined\n",
  },
  "callbacks for what has no declaration": {
    files: {
      "main.ts": `process.on("exit", code => console.log("exit", code));
const server = Bun.serve({ port: 0, fetch(request) { return new Response(new URL(request.url).pathname); } });
console.log(await (await fetch(new URL("/path", server.url))).text());
server.stop(true);
`,
    },
    checkSays: [],
    prints: "/path\nexit 0\n",
  },
  "parameters without types in functions that are handed to what has no declaration, under a strict tsconfig.json": {
    files: {
      "main.ts": `import { readFile } from "node:fs";
process.on("exit", code => console.log("exit", code));
const target = new EventTarget();
target.addEventListener("e", event => console.log(event.type));
target.addEventListener("e", ({ type }) => console.log(type));
target.addEventListener("e", (...all) => console.log(all.length));
target.dispatchEvent(new Event("e"));
new Headers({ a: "1" }).forEach((value, key) => console.log(key, value));
const stream = new ReadableStream({ start(controller) { controller.enqueue("a"); controller.close(); } });
console.log((await stream.getReader().read()).value);
await new Promise<void>(done => readFile("note.txt", "utf8", (error, text) => { console.log(error, text.trim()); done(); }));
const { port1, port2 } = new MessageChannel();
await new Promise<void>(done => {
  port1.onmessage = event => { console.log(event.data); port1.close(); done(); };
  port2.postMessage("said");
});
const server = Bun.serve({ port: 0, routes: { "/a": { GET: request => new Response(request.method) } }, fetch(request) { return new Response(new URL(request.url).pathname); } });
console.log(await (await fetch(new URL("/a", server.url))).text(), await (await fetch(new URL("/b", server.url))).text());
server.stop(true);
`,
      "note.txt": "note\n",
      "tsconfig.json": JSON.stringify({ compilerOptions: { lib: ["esnext"], strict: true } }),
    },
    checkSays: [],
    prints: "e\ne\n1\na 1\na\nnull note\nsaid\nGET /b\nexit 0\n",
  },
  "what Bun adds to classes that TypeScript's library for browsers declares": {
    files: {
      "main.ts": `const blob = new Blob(['{"a":1}']);
const stream = new ReadableStream({ start(controller) { controller.enqueue("x"); controller.close(); } });
console.log((await blob.json()).a, new Headers({ a: "1" }).toJSON().a, await stream.text());
console.write("written\\n");
`,
      "tsconfig.json": "{}",
    },
    checkSays: [],
    prints: "1 1 x\nwritten\n",
  },
  "what Bun adds to the constructor of errors": {
    files: {
      "main.ts": `Error.stackTraceLimit = 5;
Error.prepareStackTrace = (error, frames) => error.message + " " + (frames.length >= 0);
const holder: { stack?: string } = {};
Error.captureStackTrace(holder);
console.log(Error.stackTraceLimit, new Error("x").stack, typeof holder.stack);
`,
    },
    checkSays: [],
    prints: "5 x true string\n",
  },
  "what TypeScript's own libraries declare, with its types": {
    files: {
      "main.ts": `function shout(word: string | undefined): string { if (word === undefined) return "none"; return word.toUpperCase(); }
const sizes = new Map<string, number>([["a", 1]]);
const found = sizes.get("a");
if (found !== undefined) console.log(shout("a"), shout(undefined), found.toFixed(1), typeof globalThis, Number.isNaN(NaN), await Promise.resolve([1, 2].length));
`,
    },
    checkSays: ["TS2584"],
    prints: "A none 1.0 object true 2\n",
  },
  "classes below classes of Bun and of Node.js": {
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
class Bus extends EventEmitter { count = 0; bump() { this.count++; this.emit("bump", this.count); } }
class Packet extends Buffer { tag(): string { return "a packet"; } }
const bus = new Bus();
bus.on("bump", n => console.log("bump", n));
bus.bump();
console.log(Packet.from("ab").length, Object.getPrototypeOf(Packet) === Buffer);
`,
    },
    checkSays: [],
    prints: "bump 1\n2 true\n",
  },
  "arguments for a class without a constructor below each class of the language, of the web and of Node.js": {
    files: { "main.ts": oneClassBelowEach },
    checkSays: [],
    prints: `Map true a
Set true true
WeakMap true 1
Array true 3
Error true failed
TypeError true failed
Promise true 6
RegExp true g
Date true 86400000
Uint8Array true 4
ArrayBuffer true 8
DataView true 8
String true 4
Number true 12
Boolean true true
Event true e
CustomEvent true 1
MessageEvent true 1
ErrorEvent true went wrong
CloseEvent true 1001
EventTarget true function
URL true /path
URLSearchParams true 1
Headers true 1
Blob true 3
File true f.txt
Request true http://host/
Response true body
FormData true 0
TextDecoder true utf-16le
TextEncoder true utf-8
ReadableStream true false
WritableStream true false
TransformStream true false
BroadcastChannel true c
AbortController true false
DOMException true n
Buffer true 4
Worker true
WebSocket true
`,
  },
  "arguments for a class without a constructor below a class of a module, however the module is reached": {
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
import Emitter from "events";
import * as stream from "node:stream";
import { Database } from "bun:sqlite";
const { StringDecoder } = require("node:string_decoder");
class Named extends EventEmitter {}
class Default extends Emitter {}
class Member extends stream.Readable {}
class Typed extends EventEmitter<{ bump: [number] }> {}
class Required extends StringDecoder {}
class Rows extends Database {}
console.log(
  new Named({ captureRejections: true }).listenerCount("none"),
  new Default({ captureRejections: true }).listenerCount("none"),
  new Member({ objectMode: true }).readableObjectMode,
  new Typed({ captureRejections: true }).listenerCount("bump"),
  new Required("utf8").encoding,
  new Rows(":memory:").query("select 1 as one").all().length,
);
`,
    },
    checkSays: [],
    prints: "0 0 true 0 utf8 1\n",
  },
  "arguments that reach a class of the web through classes and functions of the program": {
    files: {
      "main.ts": `class Between extends Event {}
class Lowest extends Between {}
class Calling extends Between { constructor(type: string) { super(type + "!"); } }
class Direct extends Event { constructor(type: string) { super(type + "?"); } }
class WithField extends Event { count = 1; }
class Holding<T> extends Event { held?: T; }
abstract class Unfinished extends Event { abstract kind(): string; }
class Finished extends Unfinished { kind() { return "finished"; } }
const Expression = class extends Event {};
function tagged<Base extends new (...given: any[]) => any>(base: Base) { return class extends base { tag = "tagged"; }; }
class Mixed extends tagged(Event) {}
const given: ConstructorParameters<typeof Between> = ["spread"];
console.log(
  new Event("a").type,
  new Between("b").type,
  new Lowest("c").type,
  new Calling("d").type,
  new Direct("e").type,
  new WithField("f").type,
  new WithField("f").count,
  new Holding<number>("g").type,
  new Finished("h").type,
  new Finished("h").kind(),
  new Expression("i").type,
  new Mixed("j").type,
  new Mixed("j").tag,
  new Between(...given).type,
  Reflect.construct(Between, ["k"]).type,
  Reflect.construct(Event, ["l"], Lowest) instanceof Lowest,
);
`,
    },
    checkSays: [],
    prints: "a b c d! e? f 1 g h finished i j tagged spread k true\n",
  },
  "arguments for a class without a constructor below a class of the web, in a JavaScript file": {
    files: {
      "main.ts": `import { Between } from "./between.js";\nclass Lowest extends Between {}\nconsole.log(new Between("a").type, new Lowest("b").type);\n`,
      "between.js": `export class Between extends Event {}\nconsole.log(new Between("c").type);\n`,
    },
    checkSays: [],
    prints: "c\na b\n",
  },
  ...Object.fromEntries(
    [
      ["that says nothing, so that the library for browsers is in", {}],
      ["that is strict", { compilerOptions: { strict: true } }],
      ["that asks for no package of types", { compilerOptions: { types: [] } }],
      ["whose lib leaves the library for browsers out", { compilerOptions: { lib: ["esnext"] } }],
      ["whose lib names the library for browsers", { compilerOptions: { lib: ["esnext", "dom"] } }],
    ].map(([which, tsconfig]) => [
      `arguments for classes without a constructor below classes of the web and of Node.js, under a tsconfig.json ${which}`,
      {
        files: {
          "main.ts": `import { EventEmitter } from "node:events";\nclass Sent extends Event {}\nclass Bytes extends Buffer {}\nclass Bus extends EventEmitter {}\nconsole.log(new Sent("a").type, new Bytes(4).length, new Bus({ captureRejections: true }).listenerCount("none"));\n`,
          "tsconfig.json": JSON.stringify(tsconfig),
        },
        checkSays: [],
        prints: "a 4 0\n",
      },
    ]),
  ),
  "members of classes of the web and of Node.js, overridden and read below them, under the strictest options": {
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

class Between extends Event {
  readonly at = 1;
  describe(): string { return this.type + this.at; }
}
class Lowest extends Between {
  override describe(): string { return super.describe() + "!"; }
  override stopPropagation(): void { super.stopPropagation(); console.log("stopped", this.bubbles); }
  static make(type: string): Lowest { return new this(type); }
}
class Bus extends EventEmitter {
  constructor(private readonly label: string) { super({ captureRejections: true }); }
  override emit(name: string, ...rest: unknown[]): boolean { console.log(this.label, name); return super.emit(name, ...rest); }
}
class Numbers extends Readable {
  #next = 0;
  override _read(): void { this.push(this.#next < 2 ? String(this.#next++) : null); }
}
class Sink extends Writable {
  readonly seen: string[] = [];
  override _write(chunk: unknown, _encoding: string, done: () => void): void { this.seen.push(String(chunk)); done(); }
}
class Failure extends DOMException {
  override get name(): string { return "Failure"; }
}
const lowest = Lowest.make("low");
lowest.stopPropagation();
console.log(lowest.describe(), lowest.type, lowest instanceof Event, lowest.at);
const bus = new Bus("bus");
bus.on("ping", (n: number) => console.log("ping", n));
bus.emit("ping", 1);
const sink = new Sink({ decodeStrings: false });
new Numbers({ encoding: "utf8" }).pipe(sink).on("finish", () => console.log(sink.seen.join(",")));
const failure = new Failure("went wrong", "AbortError");
console.log(failure.name, failure.message, failure.code);
function takes(event: Event, between: Between): string { return event.type + between.type; }
console.log(takes(lowest, lowest));
const constructors: (new (type: string) => Between)[] = [Between, Lowest];
console.log(constructors.map(one => new one("made").type).join());
`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          lib: ["ESNext"],
          module: "Preserve",
          moduleResolution: "bundler",
          verbatimModuleSyntax: true,
          strict: true,
          noUncheckedIndexedAccess: true,
          noImplicitOverride: true,
          noUnusedLocals: true,
          noUnusedParameters: true,
          noPropertyAccessFromIndexSignature: true,
          exactOptionalPropertyTypes: true,
          noImplicitReturns: true,
        },
      }),
    },
    checkSays: [],
    prints: `stopped false
low1! low true 1
bus ping
ping 1
Failure went wrong 20
lowlow
made,made
0,1
`,
  },
  "classes of Bun's and Node.js's modules as types": {
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
import { Database } from "bun:sqlite";
import type { Server } from "node:http";
const bus: EventEmitter = new EventEmitter();
function rows(database: Database): number { return database.query("select 1 as one").all().length; }
const servers: Server[] = [];
console.log(bus.listenerCount("none"), rows(new Database(":memory:")), servers.length);
`,
    },
    checkSays: [],
    prints: "0 1 0\n",
  },
  "type arguments for classes of the web and of Node.js, where a type is written and where a class extends one": {
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
const stream: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
const event: CustomEvent<number> = new CustomEvent<number>("e", { detail: 1 });
const message: MessageEvent<string> = new MessageEvent<string>("m", { data: "d" });
const bus: EventEmitter<{ bump: [number] }> = new EventEmitter<{ bump: [number] }>();
const pair: TransformStream<string, number> = new TransformStream<string, number>();
class Chunks extends ReadableStream<Uint8Array> {}
function kind(from: ReadableStream<string> | Chunks): string { return typeof from; }
console.log(stream.locked, event.detail, message.data, bus.listenerCount("bump"), pair.readable.locked, kind(new Chunks({})));
`,
    },
    checkSays: [],
    prints: "false 1 d 0 false object\n",
  },
  "type arguments for what has no declaration": {
    files: {
      "main.ts": `import { serve } from "bun";
const server = serve<{ id: string }>({ port: 0, fetch() { return Response.json({ ok: true }); } });
const answer = await fetch(server.url).then(response => response.json());
console.log(answer.ok);
server.stop(true);
`,
    },
    checkSays: [],
    prints: "true\n",
  },
  "a tsconfig.json that names the types of Bun, as bun init writes it": {
    files: {
      "main.ts": `console.log(typeof Bun.version);\n`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          lib: ["ESNext"],
          module: "Preserve",
          moduleResolution: "bundler",
          strict: true,
          types: ["bun"],
        },
      }),
    },
    checkSays: [],
    prints: "string\n",
  },
  "a tsconfig.json that names type declarations that are not installed": {
    files: {
      "main.ts": `type IsAny<T> = 0 extends 1 & T ? true : false;
type Known<T> = IsAny<T> extends true ? never : "known";
process.on("exit", code => { const given: Known<typeof code> = "known"; console.log(given); });
`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, types: ["bun-types", "not-installed/globals"] },
      }),
    },
    checkSays: [],
    warnings: ["TS2688"],
    prints: "known\n",
  },
  "a tsconfig.json that names type declarations of an installed package outside @types": {
    files: {
      "main.ts": `const count: number | undefined = globalThis.countOfRunner;\nconsole.log(typeof count, typeof process.pid);\n`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: ["runner/globals"] } }),
      "node_modules/runner/package.json": JSON.stringify({ name: "runner", version: "1.0.0" }),
      "node_modules/runner/globals.d.ts": `declare var countOfRunner: number | undefined;\n`,
    },
    checkSays: [],
    prints: "undefined number\n",
  },
  "what Bun provides, with its types": {
    files: {
      "main.ts": `import { EventEmitter } from "node:events";
type IsAny<T> = 0 extends 1 & T ? true : false;
type Known<T> = IsAny<T> extends true ? never : "known";
const global: Known<typeof process.pid> = "known";
const ofBun: Known<typeof Bun.version> = "known";
const ofTheWeb: Known<Response["status"]> = "known";
const ofAModule: Known<EventEmitter["listenerCount"]> = "known";
process.on("exit", code => { const given: Known<typeof code> = "known"; console.log(given); });
console.log(global, ofBun, ofTheWeb, ofAModule);
`,
    },
    checkSays: [],
    prints: "known known known known\nknown\n",
  },
  "what Bun provides in ways that its declarations do not allow": {
    files: {
      "main.ts": `const port = parseInt(process.env.A_NAME_THAT_NOBODY_SETS);
const length: number = process.argv.length.toString();
const blob = new Blob(["{}"]);
console.log(port, typeof length, blob.notThere, Buffer.from("ab", "utf8", "more").length);
`,
    },
    checkSays: [],
    prints: "NaN string undefined 2\n",
  },
  "a loop that awaits what a class below a stream of Node.js yields": {
    files: {
      "main.ts": `import { Readable } from "node:stream";
class Source extends Readable {
  _read() {
    this.push(null);
  }
}
for await (const chunk of new Source()) console.log(String(chunk));
console.log("the end");
`,
    },
    checkSays: [],
    prints: "the end\n",
  },
  "the type of an instance, inferred from a class of Node.js that is passed as a constructor": {
    files: {
      "main.ts": `import EventEmitter from "node:events";
function made<T extends object>(Base: new () => T): T {
  return new Base();
}
made(EventEmitter).on("ping", () => console.log("ping")).emit("ping");
`,
    },
    checkSays: [],
    prints: "ping\n",
  },
  "options that Bun adds to what TypeScript's DOM library declares": {
    files: {
      "main.ts": `const response = fetch("http://localhost/", { unix: "/no/such/socket" });
response.catch(() => console.log("the end"));
const options: WorkerOptions = { argv: ["a"], smol: true };
console.log(options.argv);
`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
    },
    checkSays: [],
    prints: '[ "a" ]\nthe end\n',
  },
  "a package in TypeScript that uses what Bun provides in ways that its declarations do not allow": {
    files: {
      "main.ts": `import { port, twice } from "typed-package";\nconsole.log(port(), twice(2), typeof process.pid);\n`,
      "node_modules/typed-package/package.json": JSON.stringify({
        name: "typed-package",
        version: "1.0.0",
        main: "index.ts",
        types: "index.ts",
      }),
      "node_modules/typed-package/index.ts": `export function port(): number { return parseInt(process.env.A_NAME_THAT_NOBODY_SETS); }
export function twice(n: number): number { return n * 2; }
`,
    },
    checkSays: [],
    prints: "NaN 4 number\n",
  },
};

const stillErrors: [string, string, string[]][] = [
  ["a name that nothing provides", `console.log(notDeclaredAnywhere);\n`, ["TS2304"]],
  ["a name that only a browser provides", `console.log(document.title);\n`, ["TS2584"]],
  ["a name that is nearly one of Bun's", `consle.log("typo");\n`, ["TS2552"]],
  ["a type error", `const port: number = "3000";\nconsole.log(port);\n`, ["TS2322"]],
  [
    "a wrong use of what TypeScript's own libraries declare",
    `const size: string = new Map<string, number>().size;\nconsole.log(size, [1].lenght);\n`,
    ["TS2322", "TS2551"],
  ],
  [
    "a value that may be undefined",
    `const found = new Map<string, number>().get("a");\nconsole.log(found.toFixed(1));\n`,
    ["TS18048"],
  ],
  [
    "a type error in what a program declares itself",
    `function twice(n: number): number { return n * 2; }\nconsole.log(twice("2"));\n`,
    ["TS2345"],
  ],
  [
    "a missing member of the program's own type named ImportMeta",
    `interface ImportMeta { own: number }\nconst meta: ImportMeta = { own: 1 };\nconsole.log(meta.dir);\nexport {};\n`,
    ["TS2339"],
  ],
  ['a missing member of the string "bun"', `const name = "bun" as const;\nconsole.log(name.serve);\n`, ["TS2339"]],
  [
    "an argument for a class below the program's own class named Event, which takes none",
    `class Event { type = "own"; }\nclass Below extends Event {}\nconsole.log(new Below("e").type);\nexport {};\n`,
    ["TS2554"],
  ],
  [
    "one argument too many for a class below a class that TypeScript's own libraries declare",
    `class Below extends Map<string, number> {}\nconsole.log(new Below([], 1).size);\n`,
    ["TS2554"],
  ],
  [
    "a wrong argument for a constructor of the program's own below a class of the web",
    `class Below extends Event { constructor(type: string) { super(type); } }\nconsole.log(new Below(1).type);\n`,
    ["TS2345"],
  ],
  [
    "a name that nothing declares among the type arguments for a class of the web",
    `const stream: ReadableStream<Missing> | undefined = undefined;\nconsole.log(stream);\n`,
    ["TS2304"],
  ],
  [
    "a type argument for the program's own type named ReadableStream, which takes none",
    `type ReadableStream = { own: number };\nconst stream: ReadableStream<string> | undefined = undefined;\nconsole.log(stream);\nexport {};\n`,
    ["TS2315"],
  ],
  [
    "a missing member of the program's own type named Blob",
    `interface Blob { own: number }\nconst blob: Blob = { own: 1 };\nconsole.log(blob.json);\nexport {};\n`,
    ["TS2339"],
  ],
  [
    "a missing member of an error, and of the program's own type named ErrorConstructor",
    `interface ErrorConstructor { own: number }\nconst made: ErrorConstructor = { own: 1 };\nconsole.log(made.stackTraceLimit, new Error("x").notThere);\nexport {};\n`,
    ["TS2339", "TS2339"],
  ],
  [
    "a global that is no class, used as a type",
    `const memory: WebAssembly | undefined = undefined;\nconsole.log(memory);\n`,
    ["TS2749"],
  ],
  [
    "a missing member whose name quotes ImportMeta",
    `type Own = { a: number };\ntype Missing = Own["'ImportMeta'"];\nconst value: Missing | undefined = undefined;\nconsole.log(value);\n`,
    ["TS2339"],
  ],
];

describe.concurrent("without Bun's type declarations", () => {
  for (const [what, { files, checkSays, warnings = [], prints }] of Object.entries(provided)) {
    test(
      `a build goes on where a program uses ${what}`,
      () =>
        slot(async () => {
          using dir = tempDir("aot-missing-bun-types", files);
          const folder = String(dir);
          const checked = await check(folder);
          expect(checked.exitCode).toBe(1);
          if (checkSays.length) expect(checked.errors).toEqual(checkSays);
          expect((await check(folder, "--aot")).exitCode).toBe(0);
          expect(await build(folder)).toEqual({ ...built, warnings });
          const expected = { stdout: prints, exitCode: 0, signal: null };
          expect(await run(folder, "plain")).toEqual(expected);
          expect(await run(folder, "compiled")).toEqual(expected);
        }),
      buildTimeout,
    );
  }

  test.each(stillErrors)(
    "bun check --aot and a build stop at %s",
    (_what, source, errors) =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", { "main.ts": source });
        const stopped = { errors, warnings: [], exitCode: 1, signal: null };
        expect(await check(String(dir), "--aot")).toEqual(stopped);
        expect(await build(String(dir))).toEqual(stopped);
      }),
    buildTimeout,
  );

  test(
    "a module that Bun provides has the types of an installed package that declares it",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import { WebSocketServer } from "ws";\nconst server = new WebSocketServer({ port: 0 });\nserver.on("connection", socket => socket.send("a", "b"));\nserver.close();\n`,
          "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
          "node_modules/@types/ws/package.json": JSON.stringify({
            name: "@types/ws",
            version: "8.0.0",
            types: "index.d.ts",
          }),
          "node_modules/@types/ws/index.d.ts": `export declare class WebSocket { send(data: string): void; }\nexport declare class WebSocketServer {\n  constructor(options: { port: number });\n  on(event: "connection", listener: (socket: WebSocket) => void): this;\n  close(): void;\n}\n`,
        });
        expect(await build(String(dir))).toEqual({ errors: ["TS2554"], warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  test(
    "a member that overrides nothing and a member read by an index signature stop the build where every class above is the program's own",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `class Event { [name: string]: unknown; known() {} }\nclass Below extends Event { override other() {} }\nconsole.log(new Below().anything);\nexport {};\n`,
          "tsconfig.json": JSON.stringify({
            compilerOptions: { strict: true, noPropertyAccessFromIndexSignature: true },
          }),
        });
        const stopped = { errors: ["TS4111", "TS4113"], warnings: [], exitCode: 1, signal: null };
        expect(await build(String(dir))).toEqual(stopped);
      }),
    buildTimeout,
  );

  test(
    "a parameter without a type stops the build of a project whose tsconfig.json is strict",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `function twice(n) { return n * 2; }\nconst thrice = n => n * 3;\nconst all = { four: n => n * 4 };\nconsole.log(twice(2), thrice(2), all.four(2));\n`,
          "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
        });
        const errors = ["TS7006", "TS7006", "TS7006"];
        expect(await build(String(dir))).toEqual({ errors, warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );
});

test(
  "a build finds Bun's type declarations where they are installed and tsconfig.json does not list them",
  () =>
    slot(async () => {
      for (const compilerOptions of [{ strict: true }, { strict: true, types: [] }]) {
        using dir = tempDirWithBunTypes("aot-bun-types", {
          "main.ts": `const port: number = process.pid;\nconsole.log(typeof Bun.version, typeof port);\n`,
          "tsconfig.json": JSON.stringify({ compilerOptions }),
        });
        expect(await build(String(dir))).toEqual(built);
        expect(await run(String(dir), "compiled")).toEqual({ stdout: "string number\n", exitCode: 0, signal: null });
      }
    }),
  buildTimeout,
);

test(
  "bun test --aot knows the globals of the test runner, with their types",
  () =>
    slot(async () => {
      using dir = tempDir("aot-missing-bun-types", {
        "globals.test.ts": `type IsAny<T> = 0 extends 1 & T ? true : false;
type Known<T> = IsAny<T> extends true ? never : "known";
describe("globals", () => {
  beforeEach(() => {});
  it("spies", () => {
    const spy = jest.fn();
    spy();
    expect(spy).toHaveBeenCalled();
  });
  test.each([1, 2])("each %d", n => {
    const known: Known<typeof n> = "known";
    expect(known.length + n).toBeGreaterThan(5);
  });
});
`,
      });
      const { stderr, exitCode, signal } = await spawned(
        [bunExe(), "test", "--aot", "globals.test.ts"],
        String(dir),
        env,
      );
      expect({ passed: /^ 3 pass$/m.test(stderr), exitCode, signal }).toEqual({
        passed: true,
        exitCode: 0,
        signal: null,
      });
    }),
  buildTimeout,
);

test(
  "the type declarations that a project has installed count, not the ones that Bun brings along",
  () =>
    slot(async () => {
      const main = `const version: string = Bun.version;\nconsole.log(typeof version);\n`;
      using bare = tempDir("aot-installed-bun-types", { "main.ts": main });
      expect(await build(String(bare))).toEqual(built);
      using dir = tempDir("aot-installed-bun-types", {
        "main.ts": main,
        "node_modules/@types/bun/package.json": JSON.stringify({
          name: "@types/bun",
          version: "1.0.0",
          types: "index.d.ts",
        }),
        "node_modules/@types/bun/index.d.ts": `declare var Bun: { version: number };\ndeclare var console: { log(...data: unknown[]): void };\n`,
      });
      expect(await build(String(dir))).toEqual({ errors: ["TS2322"], warnings: [], exitCode: 1, signal: null });
      using alone = tempDir("aot-installed-bun-types", {
        "main.ts": main,
        "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: ["bun-types"] } }),
        "node_modules/bun-types/package.json": JSON.stringify({
          name: "bun-types",
          version: "1.0.0",
          types: "index.d.ts",
        }),
        "node_modules/bun-types/index.d.ts": `declare var Bun: { version: number };\n`,
      });
      expect(await build(String(alone))).toEqual({ errors: ["TS2322"], warnings: [], exitCode: 1, signal: null });
      using withoutWhatItRefersTo = tempDir("aot-installed-bun-types", {
        "main.ts": `type IsAny<T> = 0 extends 1 & T ? true : false;
type Known<T> = IsAny<T> extends true ? never : "known";
const version: number = Bun.version;
process.on("exit", code => { const given: Known<typeof code> = "known"; console.log(given, typeof version); });
`,
        "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
        "node_modules/bun-types/package.json": JSON.stringify({
          name: "bun-types",
          version: "1.0.0",
          types: "index.d.ts",
        }),
        "node_modules/bun-types/index.d.ts": `/// <reference types="node" />\ndeclare var Bun: { version: number };\n`,
      });
      expect(await build(String(withoutWhatItRefersTo))).toEqual(built);
      expect(await run(String(withoutWhatItRefersTo), "compiled")).toEqual({
        stdout: "known string\n",
        exitCode: 0,
        signal: null,
      });
    }),
  buildTimeout,
);

test(
  "a build with Bun's type declarations has nothing to report",
  () =>
    slot(async () => {
      using dir = tempDirWithBunTypes("aot-bun-types", {
        "main.ts": `import { version } from "bun";\nconsole.log(typeof version);\n`,
      });
      expect(await build(String(dir))).toEqual(built);
      expect(await run(String(dir), "compiled")).toEqual({ stdout: "string\n", exitCode: 0, signal: null });
    }),
  buildTimeout,
);

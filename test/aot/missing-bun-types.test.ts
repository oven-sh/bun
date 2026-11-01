// Without `@types/bun`, TypeScript knows neither `console` nor the module "bun", and `bun check` says so. A build goes on with the
// declarations that Bun brings along. They hold no program to what its project has not installed: where a program does not fit them,
// what Bun provides is of type `any`. The executable does what `bun run` does. Every other type error stops the build as always.
import { expect } from "bun:test";
import { afterAll } from "./harness/declare";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { slot, spawned } from "./harness/commands";
import { startsAtAnyEntryPoint } from "./harness/separate-programs";
import { beforeAll, describe, test } from "./supported";

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
    "a member that neither an interface nor the program's own interface above it has",
    `interface Above {\n  port: number;\n}\ninterface Below extends Above {}\nconst value: Below = { port: 1 };\nconsole.log(value.port, value.host);\n`,
    ["TS2339"],
  ],
  [
    "a member written for an interface that neither it nor the program's own interface above it has",
    `interface Above {\n  port: number;\n}\ninterface Below extends Above {}\nconst value: Below = { port: 1, host: "a" };\nconsole.log(value.port);\n`,
    ["TS2353"],
  ],
  [
    "an interface below a type that nothing declares",
    `interface Below extends Above {\n  port: number;\n}\nconst value: Below = { port: 1 };\nconsole.log(value.port);\n`,
    ["TS2304"],
  ],
  [
    "a type that the program's own namespace does not have",
    `namespace Own {\n  export type Port = number;\n}\nconst value: Own.Stats = 1;\nconsole.log(value);\n`,
    ["TS2694"],
  ],
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
    "one mistake alone, beside the whole of Bun, however it is reached, where the program's own type is expected",
    `import * as all from "bun";\nimport whole from "bun";\ninterface Wanted { main: string; plugin: unknown }\nconst wrong: number = "text";\nconst list: (Wanted | undefined)[] = [Bun, globalThis.Bun, Reflect.get(globalThis, "Bun"), all, whole, (await import("bun")).default];\nconsole.log(wrong, list.length);\n`,
    ["TS2322"],
  ],
  [
    "a missing member whose name quotes ImportMeta",
    `type Own = { a: number };\ntype Missing = Own["'ImportMeta'"];\nconst value: Missing | undefined = undefined;\nconsole.log(value);\n`,
    ["TS2339"],
  ],
];

// The programs that a build goes on with are entry points of one executable. Each is compiled as it is when it is built alone, under the tsconfig.json of its own folder.
// Whether the declarations that Bun brings along hold is decided for a build, so the programs that do not fit them have an executable of their own.
const doNotFit = new Set([
  "modules of Bun and of Node.js",
  "members of Bun and of import.meta, by destructuring and in types",
  "what Bun adds to classes that TypeScript's library for browsers declares",
  "arguments for a class without a constructor below each class of the language, of the web and of Node.js",
  "arguments for a class without a constructor below a class of a module, however the module is reached",
  "type arguments for what has no declaration",
  "what Bun provides in ways that its declarations do not allow",
  "a package in TypeScript that uses what Bun provides in ways that its declarations do not allow",
]);

// What is asked here is asked of the type checker and of what reads its answers, so the executables hold no built-in module, which makes the builds fifteen times cheaper.
// A program that uses one is built, and only plain Bun runs it. On Windows a function of the library makes process.env.
const usesABuiltInModule = (files: Record<string, string>) =>
  Object.values(files).some(text =>
    /\bfrom "(node:|bun|os"|events")|\brequire\("node:|\bBuffer\b|\bprocess\.env\b|\.toJSON\(\)|\bextends (Request|Response|ReadableStream)\b/.test(
      text,
    ),
  );

for (const fits of [true, false])
  describe.skipIf(!startsAtAnyEntryPoint)(
    "without Bun's type declarations a build goes on where a program uses",
    () => {
      const rows = Object.entries(provided)
        .filter(([what]) => doNotFit.has(what) !== fits)
        .map(([what, row], index) => ({ what, folder: `p${index}`, ...row }));
      const dir = tempDir(
        "aot-missing-bun-types",
        Object.fromEntries(
          rows.flatMap(({ folder, files }) => Object.entries(files).map(([file, text]) => [`${folder}/${file}`, text])),
        ),
      );
      afterAll(() => dir[Symbol.dispose]());
      let said: Awaited<ReturnType<typeof spawned>>;
      beforeAll(async () => {
        const entryPoints = rows.map(({ folder }) => `./${folder}/main.ts`);
        const flags = ["--aot-separate-programs", "--root=.", "--no-builtin-modules"];
        said = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, ...entryPoints, "--outfile", "app"],
          String(dir),
          env,
        );
      }, buildTimeout);

      test("the build", () => {
        const lines = said.stderr.split("\n");
        expect({
          errors: lines.filter(line => line.startsWith("error: ")),
          warnings: lines.flatMap(line => /^warn: (TS\d+): /.exec(line)?.[1] ?? []),
          exitCode: said.exitCode,
          signal: said.signal,
        }).toEqual({
          errors: [],
          warnings: rows.flatMap(({ warnings = [] }) => warnings),
          exitCode: 0,
          signal: null,
        });
      });

      for (const { what, folder, files, checkSays, prints } of rows) {
        test.concurrent(
          what,
          () =>
            slot(async () => {
              const cwd = join(String(dir), folder);
              if (checkSays.length) {
                expect(await check(cwd)).toMatchObject({ errors: checkSays, exitCode: 1 });
                expect((await check(cwd, "--aot")).exitCode).toBe(0);
              }
              const expected = { stdout: prints, exitCode: 0, signal: null };
              expect(await run(cwd, "plain")).toEqual(expected);
              if (usesABuiltInModule(files)) return;
              const executable = join(String(dir), isWindows ? "app.exe" : "app");
              const { stdout, exitCode, signal } = await spawned([executable], cwd, {
                ...bunEnv,
                BUN_AOT_START_AT: `${folder}/main.ts`,
              });
              expect({ stdout, exitCode, signal }).toEqual(expected);
            }),
          buildTimeout,
        );
      }
    },
  );

describe.concurrent("without Bun's type declarations", () => {
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
    "the whole of Bun goes where the program's own type is expected, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `interface Wanted { main: string; version: string }\nconst odd: number = Bun.version;\nconst found: Wanted | undefined = Reflect.get(globalThis, "Bun");\nconst direct: Wanted = Bun;\nconsole.log(typeof odd, typeof found?.main, direct.version === Bun.version);\n`,
        });
        expect(await build(String(dir))).toEqual(built);
        expect(await run(String(dir), "compiled")).toEqual(await run(String(dir), "plain"));
      }),
    buildTimeout,
  );

  // `declare module "node:fs";` is all that stands in for the module then, and TypeScript finds no `Stats` in that.
  test(
    "a type named through a module of Node.js or through NodeJS is any, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import * as fs from "node:fs";
import path from "node:path";
import type * as http from "node:http";
import events = require("node:events");
import * as all from "./again";
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      A_NAME_THAT_NOBODY_SETS?: string;
    }
  }
}
declare module "node:fs" {
  interface Mine {
    size: number;
  }
}
interface Options extends fs.StatOptions {
  extra: number;
}
class Bus extends events.EventEmitter implements NodeJS.EventEmitter {}
function later(handler: () => void, timeout: number, ...args: any[]): number | ReturnType<typeof setTimeout> {
  return setTimeout(handler, timeout, ...args);
}
const odd: number = process.argv.length.toString();
const stats: fs.Stats = fs.statSync(".");
const again: all.fs.Stats = stats;
const key: keyof fs.Stats = "size";
const parsed: path.ParsedPath = path.parse("/a/b.txt");
const handle: fs.promises.FileHandle | undefined = undefined;
const listener: http.RequestListener<typeof http.IncomingMessage> | undefined = undefined;
const mine: fs.Mine = { size: 1 };
const options: Options = { extra: 2 };
const current: NodeJS.Process = process;
const table: NodeJS.Dict<string> = { a: "b" };
const timer: NodeJS.Timeout = setTimeout(() => {}, 0);
clearTimeout(timer);
console.log(stats.isDirectory(), again === stats, typeof stats[key], parsed.base, handle, listener, mine.size, options.extra);
console.log(typeof current.pid, table.a, new Bus() instanceof events.EventEmitter, typeof later, typeof odd, process.env.A_NAME_THAT_NOBODY_SETS);
`,
          "again.ts": `export * as fs from "node:fs";\n`,
        });
        expect(await build(String(dir))).toEqual(built);
        const expected = {
          stdout: "true true number b.txt undefined undefined 1 2\nnumber b true function string undefined\n",
          exitCode: 0,
          signal: null,
        };
        expect(await run(String(dir), "plain")).toEqual(expected);
        expect(await run(String(dir), "compiled")).toEqual(expected);
      }),
    buildTimeout,
  );

  // No table of the run time has a name that is a type alone. The build has seen the program with Bun's declarations by then: what had a declaration there is Bun's.
  test(
    "a global of Bun or of Node.js that is a type alone is any, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `function later(handler: () => void, timeout: number, ...args: any[]): number | ReturnType<typeof setTimeout> {
  return setTimeout(handler, timeout, ...args);
}
interface Failure extends ErrnoException {
  attempts: number;
}
class Counts implements Dict<number> {
  [name: string]: number | undefined;
}
type Sizes = Partial<Record<BufferEncoding, number>>;
function explain(failure: Failure): string {
  return failure.code + " after " + failure.attempts;
}
function decode(bytes: NonSharedBuffer, encoding: BufferEncoding = "utf8"): string {
  return bytes.toString(encoding);
}
const encoding: BufferEncoding = "hex";
const bytes: Buffer<ArrayBuffer> = Buffer.from("6869", encoding);
const table: Dict<number> = { a: 1 };
const sizes: Sizes = { hex: 2 };
const counts = new Counts();
counts.b = 2;
const file: Bun.BunFile = Bun.file("nothing-here");
const server: Bun.Server<undefined> | null = null;
const controller: ReadableStreamDirectController | undefined = undefined;
const failure: Failure = Object.assign(new Error("gone"), { code: "ENOENT", attempts: 3 });
console.log(decode(bytes), bytes.length, table.a, sizes.hex, counts.b, typeof file.size, server, controller);
console.log(explain(failure), typeof later);
`,
        });
        expect(await build(String(dir))).toEqual(built);
        const expected = {
          stdout: "hi 2 1 2 2 number null undefined\nENOENT after 3 function\n",
          exitCode: 0,
          signal: null,
        };
        expect(await run(String(dir), "plain")).toEqual(expected);
        expect(await run(String(dir), "compiled")).toEqual(expected);
      }),
    buildTimeout,
  );

  test(
    "a name that nothing declares stops the build beside one of Bun's, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `const odd: number = process.argv.length.toString();
const encoding: BufferEncoding = "utf8";
const wrong: NotDeclaredAnywhere = 1;
const list: OwnList<number> = [1];
type OwnList = number[];
console.log(odd, encoding, wrong, list, neitherIsThis, [1].lenght);
`,
        });
        const errors = ["TS2304", "TS2304", "TS2315", "TS2551"];
        expect(await build(String(dir))).toEqual({ errors, warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  // Bun declares "*.txt", so with its declarations nothing is said at the import. Without them the project's own files and options count.
  test(
    "a declaration beside a text file that tsconfig.json does not allow stops the build, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        const options = {
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          noEmit: true,
          strict: true,
        };
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import text from "./note.txt";
const declared: "declared" = text;
const encoding: BufferEncoding = "utf8";
console.log(typeof declared, encoding);
`,
          "note.txt": "words\n",
          "note.d.txt.ts": `declare const text: "declared";\nexport default text;\n`,
          "tsconfig.json": JSON.stringify({ compilerOptions: options }),
        });
        expect(await build(String(dir))).toEqual({ errors: ["TS6263"], warnings: [], exitCode: 1, signal: null });
        await Bun.write(
          join(String(dir), "tsconfig.json"),
          JSON.stringify({ compilerOptions: { ...options, allowArbitraryExtensions: true } }),
        );
        expect(await build(String(dir))).toEqual(built);
        const expected = { stdout: "string utf8\n", exitCode: 0, signal: null };
        expect(await run(String(dir), "plain")).toEqual(expected);
        expect(await run(String(dir), "compiled")).toEqual(expected);
      }),
    buildTimeout,
  );

  // `any` says nothing of the control flow, so what stands in for Bun's declarations then still says which functions never return
  // and which say what their argument is.
  test(
    "process.exit, an assertion and a type predicate of Node.js narrow, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import assert, { AssertionError, fail, ok, strict, strictEqual } from "node:assert";
import strictly from "assert/strict";
import old = require("assert");
import current, { argv, exit } from "node:process";
import * as everything from "process";
import util, { inspect, types } from "node:util";
import { isRegExp } from "util/types";
type Shape = { kind: "a"; a: number } | { kind: "b"; b: string };
const odd: number = process.argv.length.toString();
function leaves(x?: string): string {
  if (!x) process.exit(1);
  return x;
}
function leavesAtTheEnd(n: number): string {
  if (n > 0) return "more";
  process.abort();
}
function leavesWhereItThrows(): number {
  let parsed: number;
  try {
    parsed = JSON.parse("4");
  } catch {
    globalThis.process.reallyExit(3);
  }
  return parsed;
}
function leavesThroughTheModule(x?: string, y?: string, z?: string): string {
  if (!x) current.exit(1);
  if (!y) everything.exit(1);
  if (!z) exit(1);
  return x + y + z;
}
function asserts(x?: string, y?: string, z?: string, w?: string): string {
  assert(x);
  assert.ok(y, "y");
  ok(z);
  old(w);
  return x + y + z + w;
}
function assertsStrictly(x?: string, y?: string): string {
  strict(x);
  assert.strict.ok(y);
  return x + y;
}
function fails(x?: string, y?: string): string {
  if (!x) fail("x");
  if (!y) assert.fail();
  return x + y;
}
function compares(one: Shape, two: Shape, three: Shape, list: unknown, error: Error | null): [number, number[], null] {
  strictEqual(one.kind, "a");
  assert.strictEqual(two.kind, "a", "two");
  strictly.equal(three.kind, "a");
  assert.deepStrictEqual(list, [1]);
  assert.ifError(error);
  return [one.a + two.a + three.a, list, error];
}
function tells(x: string | Date, y: string | RegExp, z: unknown, w: string | Uint8Array | DataView): unknown[] {
  return [
    types.isDate(x) ? x.getFullYear() : x.length,
    util.types.isDate(x) ? x.getMonth() : x.toUpperCase(),
    isRegExp(y) ? y.source : y.length,
    types.isMap(z) ? z.size : types.isNativeError(z) ? z.message : null,
    types.isTypedArray(w) ? w.length : types.isDataView(w) ? w.byteLength : w.toUpperCase(),
  ];
}
class Failed extends assert.AssertionError {}
class Decoder extends util.TextDecoder {}
interface Wanted {
  pid: number;
}
const whole: Wanted = process;
const kept: assert.AssertionError | undefined = undefined;
const options: util.InspectOptions = { depth: 0 };
const a: Shape = { kind: "a", a: 1 };
console.log(typeof odd, leaves("x"), leavesAtTheEnd(1), leavesWhereItThrows(), leavesThroughTheModule("x", "y", "z"));
console.log(asserts("x", "y", "z", "w"), assertsStrictly("x", "y"), fails("x", "y"), compares(a, a, a, [1], null));
console.log(tells("text", /r/, new Map([[1, 2]]), new Uint8Array(3)), tells(new Date(2020, 5, 5), "s", new Error("e"), "w"));
console.log(new Failed({ message: "m" }) instanceof AssertionError, new Decoder().encoding, typeof whole.pid, kept);
console.log(inspect({ a: { b: 1 } }, options), argv.length > 0, typeof everything.platform, typeof assert.deepEqual);
process.exit = () => {
  console.log("stays");
};
console.log(typeof leaves());
`,
        });
        expect(await build(String(dir))).toEqual(built);
        const expected = {
          stdout: `string x more 4 xyz
xyzw xy xy [ 3, [ 1 ], null ]
[ 4, "TEXT", "r", 1, 3 ] [ 2020, 5, 1, "e", "W" ]
true utf-8 number undefined
{ a: [Object] } true string function
stays
undefined
`,
          exitCode: 0,
          signal: null,
        };
        expect(await run(String(dir), "plain")).toEqual(expected);
        expect(await run(String(dir), "compiled")).toEqual(expected);
      }),
    buildTimeout,
  );

  // A class of the run time is `any` then. Where the answer is yes the value is `any` too, and where it is no nothing is known of it.
  test(
    "Buffer.isBuffer and the other predicates about a class of the run time narrow, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import buffer, { Buffer as Named, type TranscodeEncoding } from "node:buffer";
import * as wholeBuffer from "buffer";
import oldBuffer = require("buffer");
import { createSecretKey } from "node:crypto";
import net, { BlockList, Socket, type AddressInfo } from "node:net";
import * as wholeNet from "net";
import util, { types } from "node:util";
import { isCryptoKey, isKeyObject } from "util/types";
type Message = { data: null; why: string } | { data: Uint8Array; why?: undefined };
const odd: number = process.argv.length.toString();
function hex(x: string | Uint8Array): string {
  return Buffer.isBuffer(x) ? x.toString("hex") : typeof x;
}
function ofUnknown(x: unknown): unknown {
  if (globalThis.Buffer.isBuffer(x)) return x.readUInt8(0);
  return x;
}
function otherwise(x: string | Uint8Array): number {
  if (!Buffer.isBuffer(x)) return x.length;
  return x.readUInt8(0);
}
function throughTheModule(x: string | Uint8Array): unknown[] {
  return [
    Named.isBuffer(x) ? x.toString("base64") : x.length,
    buffer.Buffer.isBuffer(x) ? x.toString("latin1") : x.length,
    wholeBuffer.Buffer.isBuffer(x) ? x.readUInt8(0) : x.length,
    oldBuffer.Buffer.isBuffer(x) ? x.readInt8(0) : x.length,
  ];
}
function ofMember(holder: { data: string | Uint8Array }): string | number {
  return Buffer.isBuffer(holder.data) ? holder.data.toString("hex") : holder.data.length;
}
function besideOtherMembers(message: Message): string | undefined {
  return Buffer.isBuffer(message.data) ? message.data.toString("hex") + message.why : message.why;
}
function throughChain(holder?: { data: Uint8Array }): string | boolean {
  return Buffer.isBuffer(holder?.data) ? holder.data.toString("hex") : holder === undefined;
}
function behindTheTest(x: string | Uint8Array): number {
  if (Buffer.isBuffer(x)) x = x.toString("hex");
  return x.length;
}
function encoding(x: string | number): string {
  return Buffer.isEncoding(x) ? x.toUpperCase() : x.toString() + " is none";
}
function listed(x: unknown, y: string | object, z: unknown): unknown[] {
  return [
    BlockList.isBlockList(x) ? x.check("127.0.0.1") : x,
    net.BlockList.isBlockList(y) ? y.check("127.0.0.2") : y.toString(),
    wholeNet.BlockList.isBlockList(z) ? z.rules.length : z,
  ];
}
function keys(x: unknown, y: string | object): unknown[] {
  return [
    types.isKeyObject(x) ? x.type : typeof x,
    util.types.isKeyObject(y) ? y.symmetricKeySize : y.toString(),
    isKeyObject(x) ? x.type : typeof x,
    types.isCryptoKey(x) ? x.algorithm.name : typeof x,
    util.types.isCryptoKey(y) ? y.extractable : y.toString(),
    isCryptoKey(x) ? x.type : typeof x,
  ];
}
function handedOn(list: (string | Uint8Array)[], others: unknown[]): unknown[] {
  const isBytes = Buffer.isBuffer;
  const first = list.find(Named.isBuffer);
  return [
    list.filter(Buffer.isBuffer).map(it => it.toString("hex")),
    list.map(it => (isBytes(it) ? it.readUInt8(0) : it.length)),
    first === undefined ? first : first.toString("base64"),
    others.filter(net.BlockList.isBlockList).map(it => it.check("127.0.0.1")),
    others.filter(types.isKeyObject).map(it => it.type),
  ];
}
class Line extends Socket {}
class Wire extends net.Socket {}
class Bytes extends Named {}
interface Wanted {
  poolSize: number;
}
const whole: Wanted = Buffer;
const wholeOfTheModule: Wanted = Named;
const address: AddressInfo | null = null;
const options: net.NetConnectOpts = { port: 1 };
const named: TranscodeEncoding = "utf8";
const kept: Named = Named.from("a");
const list: BlockList = new BlockList();
list.addAddress("127.0.0.1");
const secret = createSecretKey(Buffer.from("0123456789abcdef"));
const signing = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
console.log(typeof odd, hex(Buffer.from("a")), hex("a"), hex(new Uint8Array(1)), ofUnknown(Buffer.from("a")), ofUnknown(1));
console.log(otherwise("abc"), otherwise(Buffer.from("a")), throughTheModule(Buffer.from("a")), throughTheModule("abc"));
console.log(ofMember({ data: Buffer.from("a") }), ofMember({ data: "abc" }), behindTheTest(Buffer.from("a")), behindTheTest("abc"));
console.log(besideOtherMembers({ data: Buffer.from("a") }), besideOtherMembers({ data: null, why: "none" }));
console.log(throughChain({ data: Buffer.from("a") }), throughChain({ data: new Uint8Array(1) }), throughChain());
console.log(encoding("hex"), encoding("no"), encoding(1), listed(list, list, list), listed(1, "y", null));
console.log(keys(secret, secret), keys(signing, signing), keys(1, "y"));
console.log(handedOn(["abc", Buffer.from("a"), new Uint8Array(2)], [1, list, secret]), handedOn([], []));
console.log(new Line() instanceof Socket, new Wire() instanceof Socket, Object.getPrototypeOf(Bytes) === Buffer, typeof whole.poolSize);
console.log(wholeOfTheModule === whole, address, options, named, kept.length, typeof net.createServer, net.isIP("::1"));
console.log(buffer.constants.MAX_LENGTH > 0, typeof wholeBuffer.kMaxLength, typeof oldBuffer.Blob, typeof wholeNet.connect);
`,
        });
        expect(await build(String(dir))).toEqual(built);
        const expected = {
          stdout: `string 61 string object 97 1
3 97 [ "YQ==", "a", 97, 97 ] [ 3, 3, 3, 3 ]
61 3 2 3
61undefined none
61 false true
HEX no is none 1 is none [ true, false, 1 ] [ 1, "y", null ]
[ "secret", 16, "secret", "object", "[object KeyObject]", "object" ] [ "object", "[object CryptoKey]",
  "object", "HMAC", false, "secret"
] [ "number", "y", "number", "number", "y", "number" ]
[
  [ "61" ], [ 3, 97, 2 ], "YQ==", [ true ], [ "secret" ]
] [
  [], [], undefined, [], []
]
true true true number
true null {
  port: 1,
} utf8 1 function 6
true number function function
`,
          exitCode: 0,
          signal: null,
        };
        expect(await run(String(dir), "plain")).toEqual(expected);
        expect(await run(String(dir), "compiled")).toEqual(expected);
      }),
    buildTimeout,
  );

  test(
    "such a predicate narrows where it is taken out of its holder by a pattern or under brackets",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import net from "node:net";
import { types } from "node:util";
const odd: number = process.argv.length.toString();
const { isBuffer, isEncoding: knows, poolSize } = Buffer;
const { isBlockList } = net.BlockList;
const { isKeyObject = () => false } = types;
function byAPattern(x: string | Uint8Array): string {
  return isBuffer(x) ? x.toString("hex") : typeof x;
}
function underAnotherName(x: unknown): unknown {
  return knows(x) ? x.toUpperCase() : typeof x;
}
function underBrackets(x: string | Uint8Array): unknown[] {
  return [
    Buffer["isBuffer"](x) ? x.toString("hex") : x.length,
    Buffer[\`isBuffer\`](x) ? x.readUInt8(0) : x.length,
    globalThis.Buffer["isBuffer"](x) ? x.toString("base64") : x.length,
  ];
}
function ofOtherHolders(x: unknown): unknown[] {
  return [
    isBlockList(x) ? x.check("127.0.0.1") : typeof x,
    net["BlockList"]["isBlockList"](x) ? x.check("::1") : typeof x,
    isKeyObject(x) ? x.type : typeof x,
  ];
}
function handedOn(list: (string | Uint8Array)[]): unknown[] {
  return [list.filter(isBuffer).map(it => it.toString("hex")), list.filter(Buffer["isBuffer"]).map(it => it.readUInt8(0))];
}
const list = new net.BlockList();
list.addAddress("127.0.0.1");
console.log(typeof odd, typeof poolSize, byAPattern(Buffer.from("a")), byAPattern("a"), underAnotherName("hex"), underAnotherName(1));
console.log(underBrackets(Buffer.from("a")), underBrackets("abc"), ofOtherHolders(list), ofOtherHolders(1));
console.log(handedOn(["abc", Buffer.from("a"), new Uint8Array(2)]));
`,
        });
        expect(await build(String(dir))).toEqual(built);
        const plain = await run(String(dir), "plain");
        expect(plain).toMatchObject({ exitCode: 0, signal: null });
        expect(plain.stdout).toStartWith("string number 61 string HEX number\n");
        expect(await run(String(dir), "compiled")).toEqual(plain);
      }),
    buildTimeout,
  );

  test(
    "a guard narrows where the class of the run time stands deeper in its type, behind a type parameter, or where nobody writes the guard down",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import { EventEmitter } from "node:events";
const odd: number = process.argv.length.toString();
interface Holder { held: string | Uint8Array; name: string }
function holdsBytes(holder: Holder): holder is Holder & { held: Buffer } {
  return holder.held instanceof Buffer;
}
function deeper(holder: Holder): string {
  return holdsBytes(holder) ? holder.name + holder.held.toString("hex") : holder.name + typeof holder.held;
}
function isA<T>(x: unknown, kind: new (...list: any[]) => T): x is T {
  return x instanceof kind;
}
function behindAParameter(x: string | Uint8Array): unknown[] {
  return [isA<Buffer>(x, Buffer) ? x.toString("hex") : typeof x, isA(x, Buffer) ? x.toString("base64") : x.length, isA<EventEmitter>(x, EventEmitter) ? x.listenerCount("a") : x.length];
}
class Own { own = 1 }
function ofTheProgramsOwnClass(x: Own | string): number {
  return isA(x, Own) ? x.own : x.length;
}
function writtenAsAny(x: string | number): unknown {
  return isA<any>(x, Object) ? typeof x : ((nothing: never) => "never")(x);
}
const isBytes = (x: string | Uint8Array) => x instanceof Buffer;
function nobodyWritesItDown(list: (string | Uint8Array)[]): unknown[] {
  return [
    list.filter(x => x instanceof Buffer).map(x => x.toString("hex")),
    list.filter(isBytes).map(x => x.readUInt8(0)),
    list.map(x => (isBytes(x) ? x.toString("latin1") : x.length)),
    list.find(x => x instanceof Buffer)?.toString("hex"),
  ];
}
function keepsItsMembers(value: { a: number; b?: string }): unknown {
  const hasA = (it: { a: number; b?: string }): it is { a: number } => it.a > 0;
  return hasA(value) ? value.b : undefined;
}
console.log(typeof odd, deeper({ held: Buffer.from("a"), name: "n" }), deeper({ held: "a", name: "n" }));
console.log(behindAParameter(Buffer.from("a")), behindAParameter("abc"), ofTheProgramsOwnClass(new Own()), ofTheProgramsOwnClass("ab"), writtenAsAny("a"));
console.log(nobodyWritesItDown(["abc", Buffer.from("a"), new Uint8Array(2)]), keepsItsMembers({ a: 1, b: "b" }));
`,
        });
        expect(await build(String(dir))).toEqual(built);
        const plain = await run(String(dir), "plain");
        expect(plain).toMatchObject({ exitCode: 0, signal: null });
        expect(plain.stdout).toStartWith("string n61 nstring\n");
        expect(await run(String(dir), "compiled")).toEqual(plain);
      }),
    buildTimeout,
  );

  test(
    "a predicate of the program's own about a class of the run time narrows, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import { EventEmitter } from "node:events";
import * as http from "node:http";
import { Socket } from "node:net";
type Guard = (x: unknown) => x is URL;
interface Tells {
  isSocket(x: unknown): x is Socket;
}
const odd: number = process.argv.length.toString();
function isBytes(x: string | Uint8Array): x is Buffer {
  return x instanceof Buffer;
}
function assertBytes(x: unknown): asserts x is Buffer {
  if (!Buffer.isBuffer(x)) throw new TypeError("no bytes");
}
const isEmitter = (x: unknown): x is EventEmitter => x instanceof EventEmitter;
function isServer(x: unknown): x is http.Server {
  return x instanceof http.Server;
}
const isURL: Guard = (x): x is URL => x instanceof URL;
const tells: Tells = { isSocket: (x): x is Socket => x instanceof Socket };
class Holder {
  constructor(public held: unknown) {}
  isBlob(x: string | object): x is Blob {
    return x instanceof Blob;
  }
}
function hex(x: string | Uint8Array): string {
  return isBytes(x) ? x.toString("hex") : typeof x === "string" ? x.toUpperCase() : String(x.byteLength);
}
function told(x: unknown, y: string | object): unknown[] {
  return [
    isEmitter(x) ? x.listenerCount("a") : typeof x,
    isServer(x) ? x.listening : typeof x,
    isURL(x) ? x.host : typeof x,
    tells.isSocket(x) ? x.destroyed : typeof x,
    new Holder(1).isBlob(y) ? y.size : y.toString(),
  ];
}
function asserted(x: unknown): string {
  assertBytes(x);
  return x.toString("hex");
}
function refused(x: unknown): string {
  try {
    return asserted(x);
  } catch (error) {
    return error instanceof TypeError ? error.message : "other";
  }
}
function picked(list: (string | Uint8Array)[], holder: Holder): unknown[] {
  return [list.filter(isBytes).map(it => it.toString("hex")), isEmitter(holder.held) ? holder.held.listenerCount("a") : typeof holder.held];
}
console.log(typeof odd, hex(Buffer.from("a")), hex("a"), hex(new Uint8Array(2)), asserted(Buffer.from("b")), refused("b"));
console.log(told(new EventEmitter(), new Blob(["abc"])), told(http.createServer(), "y"), told(new URL("http://host/"), {}));
console.log(told(new Socket(), "z"), picked(["a", Buffer.from("a"), new Uint8Array(1)], new Holder(new EventEmitter())), picked([], new Holder(1)));
`,
        });
        expect(await build(String(dir))).toEqual(built);
        const expected = {
          stdout: `string 61 A 2 62 no bytes
[ 0, "object", "object", "object", 3 ] [ 0, false, "object", "object", "y" ] [ "object", "object",
  "host", "object", "[object Object]"
]
[ 0, "object", "object", false, "z" ] [
  [ "61" ], 0
] [
  [], "number"
]
`,
          exitCode: 0,
          signal: null,
        };
        expect(await run(String(dir), "plain")).toEqual(expected);
        expect(await run(String(dir), "compiled")).toEqual(expected);
      }),
    buildTimeout,
  );

  test.each([
    [
      "a function of Buffer that says nothing of its argument",
      `function hex(x: string | Uint8Array): string {\n  return Buffer.byteLength(x) ? x.toString("hex") : typeof odd;\n}\nconsole.log(hex("a"));\n`,
      ["TS2554"],
    ],
    [
      "a predicate of the program's own that says any, which leaves never where the answer is no",
      `function isAnything(value: unknown): value is any {\n  return value !== odd;\n}\nfunction size(x: string | Uint8Array): number {\n  return isAnything(x) ? 0 : x.length;\n}\nconsole.log(size("a"));\n`,
      ["TS2339"],
    ],
  ])(
    "%s narrows as TypeScript has it, in a program that does not fit Bun's declarations",
    (_what, rest, errors) =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `const odd: number = process.argv.length.toString();\n${rest}`,
        });
        expect(await build(String(dir))).toEqual({ errors, warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  test(
    "a call of process that returns narrows nothing, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `const odd: number = process.argv.length.toString();\nfunction stays(x?: string): string {\n  if (!x) process.emitWarning("x");\n  return x;\n}\nconsole.log(odd, stays("x"));\n`,
        });
        expect(await build(String(dir))).toEqual({ errors: ["TS2322"], warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  test(
    "instanceof a class that Bun provides narrows, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import assert, { AssertionError } from "node:assert";
import * as events from "node:events";
import { EventEmitter } from "node:events";
import stream = require("node:stream");
const odd: number = process.argv.length.toString();
const Kept = URL;
const kept = { URL, Emitter: EventEmitter };
class Mine extends EventEmitter {
  own = 7;
}
class Holder {
  constructor(public held: unknown) {}
  count(): number {
    return this.held instanceof EventEmitter ? this.held.listenerCount("a") : -1;
  }
}
function byName(x: unknown): unknown[] {
  return [x instanceof URL ? x.href : "no", x instanceof Buffer ? x.length : -1, x instanceof EventEmitter ? x.listenerCount("a") : -1];
}
function throughAModule(x: unknown): unknown[] {
  return [
    x instanceof events.EventEmitter ? x.listenerCount("a") : -1,
    x instanceof stream.Readable ? typeof x.read : "no",
    x instanceof assert.AssertionError ? x.code : "no",
    x instanceof globalThis.URL ? x.host : "no",
  ];
}
function keptSomewhere(x: unknown, Given: typeof URL): unknown[] {
  return [x instanceof Kept ? x.href : "no", x instanceof kept.URL ? x.host : "no", x instanceof kept.Emitter ? x.listenerCount("a") : -1, x instanceof Given ? x.pathname : "no"];
}
function inStatements(x: unknown): string {
  if (!(x instanceof Object)) return "no object";
  if (x instanceof Headers) return "headers " + x.get("a");
  if (x instanceof Response || x instanceof Request) return "url " + x.url;
  const isBlob = x instanceof Blob;
  if (isBlob) return "blob " + x.size;
  if (!(x instanceof URLSearchParams)) return "other";
  return "search " + x.get("a");
}
function ofAUnion(x: string | Uint8Array, y: string | URL, z: number | { n: number }): unknown[] {
  return [
    x instanceof Buffer ? x.toString("hex") : typeof x === "string" ? x.toUpperCase() : x.byteLength,
    y instanceof URL ? y.href : y.trim(),
    z instanceof Blob ? z.size : typeof z === "number" ? z + 1 : z.n,
  ];
}
function caught(run: () => void): string {
  try {
    run();
    return "nothing";
  } catch (error: unknown) {
    if (error instanceof AssertionError) return "assertion " + error.code;
    if (error instanceof DOMException) return "dom " + error.name;
    if (error instanceof Error) return "error " + error.message;
    return "thrown";
  }
}
function below(x: unknown): number {
  return x instanceof EventEmitter ? (x instanceof Mine ? x.own : x.listenerCount("a")) : x instanceof Mine ? x.own : -1;
}
const url = new URL("http://host/path");
const show = (...all: unknown[]) => console.log(JSON.stringify(all));
show(typeof odd, byName(url), byName(Buffer.from("ab")), byName(new EventEmitter()), byName("text"));
show(throughAModule(new EventEmitter()), throughAModule(new stream.Readable()), throughAModule(new AssertionError({ message: "m" })), throughAModule(url));
show(keptSomewhere(url, URL), keptSomewhere(new Mine(), URL), new Holder(new Mine()).count(), new Holder(url).count());
show([1, new Headers({ a: "b" }), new Request("http://host/r"), new Blob(["abc"]), new URLSearchParams("a=c"), {}].map(inStatements));
show(ofAUnion(Buffer.from("a"), url, 1), ofAUnion("a", " y ", { n: 5 }), ofAUnion(new Uint8Array(3), "y", 2));
show(
  caught(() => assert.strictEqual(1, 2)),
  caught(() => structuredClone(() => {})),
  caught(() => {
    throw new RangeError("far");
  }),
  caught(() => {
    throw 1;
  }),
  caught(() => {}),
);
show(below(new Mine()), below(new EventEmitter()), below(url));
`,
        });
        expect(await build(String(dir))).toEqual(built);
        const expected = {
          stdout: `["string",["http://host/path",-1,-1],["no",2,-1],["no",-1,0],["no",-1,-1]]
[[0,"no","no","no"],[0,"function","no","no"],[-1,"no","ERR_ASSERTION","no"],[-1,"no","no","host"]]
[["http://host/path","host",-1,"/path"],["no","no",0,"no"],0,-1]
[["no object","headers b","url http://host/r","blob 3","search c","other"]]
[["61","http://host/path",2],["A","y",5],[3,"y",3]]
["assertion ERR_ASSERTION","dom DataCloneError","error far","thrown","nothing"]
[7,0,-1]
`,
          exitCode: 0,
          signal: null,
        };
        expect(await run(String(dir), "plain")).toEqual(expected);
        expect(await run(String(dir), "compiled")).toEqual(expected);
      }),
    buildTimeout,
  );

  test.each([
    [
      "where the answer is no",
      `function href(x: unknown): string {\n  return x instanceof URL ? "url" : x.href;\n}\nconsole.log(odd, href(1));\n`,
      ["TS18046"],
    ],
    [
      "behind the statement",
      `function href(x: unknown): string {\n  if (x instanceof URL) console.log(x.href);\n  return x.href;\n}\nconsole.log(odd, href(1));\n`,
      ["TS18046"],
    ],
    [
      "of the program's own class named URL",
      `class URL {\n  own = 1;\n}\nfunction href(x: unknown): string {\n  return x instanceof URL ? x.href : "no";\n}\nconsole.log(odd, href(1));\nexport {};\n`,
      ["TS2339"],
    ],
  ])(
    "instanceof narrows to nothing more %s, in a program that does not fit Bun's declarations",
    (_what, source, errors) =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `const odd: number = process.argv.length.toString();\n${source}`,
        });
        expect(await build(String(dir))).toEqual({ errors, warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  test(
    "a type named through a module that the program itself declares without members stops the build",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import * as thing from "thing";\nconst value: thing.Unknown = thing.one;\nconsole.log(value);\n`,
          "thing.d.ts": `declare module "thing";\n`,
          "tsconfig.json": JSON.stringify({ files: ["main.ts", "thing.d.ts"] }),
          "node_modules/thing/package.json": JSON.stringify({ name: "thing", version: "1.0.0", main: "index.js" }),
          "node_modules/thing/index.js": `exports.one = 1;\n`,
        });
        expect(await build(String(dir))).toEqual({ errors: ["TS2694"], warnings: [], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  // A name that comes out of `declare module "node:fs";` is the module itself to TypeScript: a value and a namespace, no type.
  test(
    "what a file of the program exports again from a module of Node.js is any, in a program that does not fit Bun's declarations",
    () =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", {
          "main.ts": `import * as named from "./named";
import * as whole from "./whole";
import * as outer from "./outer";
import { existsSync, own, type Dirent } from "./whole";
import type * as http from "node:http";
interface Sized extends named.Stats {
  extra?: number;
}
interface Asked extends http.IncomingMessage {
  user?: string;
}
interface Wanted extends http.RequestOptions {
  retries?: number;
}
class Bus extends named.EventEmitter implements named.EventEmitter {}
const odd: number = process.argv.length.toString();
const stats: named.Stats = named.statSync(".");
const renamed: named.FileStats = stats;
const imported: named.Imported = stats;
const typeOnly: named.TypeOnly = stats;
const byImportType: import("./named").Stats = stats;
const throughTwoFiles: outer.Stats = stats;
const throughNamespace: outer.named.Stats = stats;
const key: keyof named.Stats = "size";
const listeners: named.RequestListener<any, any>[] = [];
const sized: Sized = stats;
const { statSync } = whole;
const ofWhole: whole.Stats = statSync(".");
const ofWholeByImportType: import("./whole").Stats = ofWhole;
const ofWholeThroughTwoFiles: outer.Dirent | undefined = undefined;
const entry: Dirent | undefined = ofWholeThroughTwoFiles;
console.log(stats.isDirectory(), [renamed, imported, typeOnly, byImportType, throughTwoFiles, throughNamespace, sized].every(it => it === stats));
console.log(typeof stats[key], listeners.length, new Bus() instanceof named.EventEmitter, typeof odd);
console.log(ofWhole.isDirectory(), ofWholeByImportType === ofWhole, entry, existsSync("."), outer.existsSync === existsSync, own, whole.own);
const asked = { url: "/a" } as Asked;
const wanted: Wanted = { host: "localhost", retries: 2 };
console.log(sized.isDirectory(), sized.extra, asked.url, asked.user, wanted.host, wanted.retries);
`,
          "named.ts": `import { Stats as Imported } from "node:fs";
export { Imported };
export { Stats, Stats as FileStats, statSync } from "node:fs";
export type { Stats as TypeOnly } from "node:fs";
export type { RequestListener } from "node:http";
export { EventEmitter } from "node:events";
`,
          "whole.ts": `export * from "node:fs";\nexport const own = 1;\n`,
          "outer.ts": `export * as named from "./named";\nexport { Stats } from "./named";\nexport * from "./whole";\n`,
        });
        expect(await build(String(dir))).toEqual(built);
        const expected = {
          stdout:
            "true true\nnumber 0 true string\ntrue true undefined true true 1 1\ntrue undefined /a undefined localhost 2\n",
          exitCode: 0,
          signal: null,
        };
        expect(await run(String(dir), "plain")).toEqual(expected);
        expect(await run(String(dir), "compiled")).toEqual(expected);
      }),
    buildTimeout,
  );

  test.each([
    [
      "a value of the program's own, named as a type",
      {
        "main.ts": `import * as all from "./again";\nconst value: all.port = 1;\nconsole.log(value);\n`,
        "again.ts": `export * from "node:fs";\nexport const port = 1;\n`,
      },
      ["TS2749"],
    ],
    [
      "a name out of a module that the program itself declares without members, named as a type",
      {
        "main.ts": `import * as all from "./again";\nconst value: all.Unknown = all.one;\nconsole.log(value);\n`,
        "again.ts": `export { Unknown, one } from "thing";\n`,
        "thing.d.ts": `declare module "thing";\n`,
        "tsconfig.json": JSON.stringify({ files: ["main.ts", "thing.d.ts"] }),
        "node_modules/thing/package.json": JSON.stringify({ name: "thing", version: "1.0.0", main: "index.js" }),
        "node_modules/thing/index.js": `exports.one = 1;\nexports.Unknown = 2;\n`,
      },
      ["TS2749"],
    ],
    [
      "names that none of the program's own modules has",
      {
        "main.ts": `import * as all from "./again";\nimport type { Gone } from "./again";\nconst value: all.Gone = all.missing;\nconst other: import("./again").Gone | Gone = 1;\nconsole.log(value, other, all.here);\n`,
        "again.ts": `export * from "./once";\n`,
        "once.ts": `export const here = 1;\n`,
      },
      ["TS2305", "TS2339", "TS2694", "TS2694"],
    ],
  ])(
    "a build stops at %s, through a file that exports it again",
    (_what, files, errors) =>
      slot(async () => {
        using dir = tempDir("aot-missing-bun-types", files);
        expect(await build(String(dir))).toEqual({ errors, warnings: [], exitCode: 1, signal: null });
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

  // `any` as the type of a declared parameter says as little with Bun's types installed, so TypeScript's error stays one.
  test(
    "a parameter without a type in a function that is handed to what the program declares stops the build, as it stops bun check",
    () =>
      slot(async () => {
        const callees = [
          "ofJavaScript(",
          "declared(",
          "arrow(",
          "withRest(0, ",
          "holder.method(",
          "new Holder(",
          "Holder.made(",
          "generic<number>(",
          "overloaded(",
        ];
        const given = [
          "x => x",
          "function (x) { return x; }",
          "(x, y) => [x, y]",
          "(...all) => all",
          "({ a }) => a",
          "([a]) => a",
          "{ run: x => x }",
          "{ run(x) { return x; } }",
          "{ deep: { run: x => x } }",
          "[x => x]",
          "[{ run: x => x }]",
        ];
        const calls = callees.flatMap(callee => given.map(argument => `results.push(${callee}${argument}));`));
        using dir = tempDir("aot-missing-bun-types", {
          "own.js": `export function ofJavaScript(run) { return typeof run; }\n`,
          "main.ts": `import { ofJavaScript } from "./own.js";
function declared(run: any) { return typeof run; }
const arrow = (run: any) => typeof run;
function withRest(first: number, ...rest: any[]) { return first + rest.length; }
class Holder { constructor(run?: any) { this.kind = typeof run; } kind: string; method(run: any) { return typeof run; } static made(run: any) { return typeof run; } }
const holder = new Holder();
function generic<T>(run: any): T | string { return typeof run; }
function overloaded(run: any): string;
function overloaded(run: any, more: number): string;
function overloaded(run: any) { return typeof run; }
export const results: unknown[] = [];
${calls.join("\n")}
`,
          "tsconfig.json": JSON.stringify({
            compilerOptions: { lib: ["esnext"], strict: true, allowJs: true, types: [] },
          }),
        });
        const checked = await check(String(dir));
        expect(checked.errors.length).toBeGreaterThanOrEqual(calls.length);
        expect(new Set(checked.errors)).toEqual(new Set(["TS7006", "TS7019", "TS7031"]));
        expect(await build(String(dir))).toEqual({ errors: checked.errors, warnings: [], exitCode: 1, signal: null });
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

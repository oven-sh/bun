// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: classes-and-closures/functions-classes-keys-brackets-listed.ts classes-and-closures/functions-classes-keys-brackets-printed.ts host-classes/bodies-every-holder-parsed-alike.ts stress/one-odd-line-more/throw-caught.js
// CWD: classes-and-closures
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 2

// FILE: classes-and-closures/functions-classes-keys-brackets-listed.ts
// Imports the program that PROGRAM names, in an executable that holds that program and two more as entry points.
await import(process.env.PROGRAM!);
export {};

// FILE: classes-and-closures/functions-classes-keys-brackets-printed.ts
// Functions and classes that stand under a key in brackets whose value is written there: what console.log, Bun.inspect and util.inspect print for each, its `name`, its own keys, its instances and its frame in a stack trace.
import util from "node:util";

enum Color {
  Red,
  Green = "green",
}
const enum Fixed {
  One = 1,
  Text = "text",
}
const constantText = "constantText";
const described = Symbol("described");

function fail(): never {
  throw new Error("x");
}

function framesOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    const lines = String((error as Error).stack).split("\n");
    return lines
      .slice(2, 4)
      .map(line =>
        line
          .trim()
          .replace(/ ?\(.*\)$/, "")
          .replace(/at (?:[A-Z]:)?[\\/].*$/, "at <file>"),
      )
      .join(" < ");
  }
  return "nothing thrown";
}

function show(label: string, value: any, call?: () => unknown) {
  console.log(label, "|", value, "|", Bun.inspect(value), "|", util.inspect(value), "|", JSON.stringify(value.name));
  console.log(
    " ",
    Object.getOwnPropertyNames(value).join(),
    "|",
    JSON.stringify(Object.getOwnPropertyDescriptor(value, "name")),
  );
  if (call) console.log("  frames:", framesOf(call));
}

function showMembers(label: string, holder: any, receiver: any = holder) {
  for (const key of Reflect.ownKeys(holder)) {
    if (key === "constructor" || key === "prototype" || key === "length" || key === "name") continue;
    const { value, get, set } = Object.getOwnPropertyDescriptor(holder, key)!;
    const name = `${label} ${String(key)}`;
    if (get) show(`${name} getter`, get, () => receiver[key]);
    if (set) show(`${name} setter`, set, () => (receiver[key] = 1));
    if (typeof value !== "function") continue;
    const isClass = /^class/.test(Function.prototype.toString.call(value));
    show(name, value, () => {
      const answer = isClass ? new value() : receiver[key]();
      return typeof answer?.next === "function" ? answer.next() : answer;
    });
    if (isClass) console.log("  instance:", Object.create(value.prototype), value.prototype);
  }
  console.log(label, holder);
}

showMembers("methods", {
  [7]() {
    fail();
  },
  [-1024]() {
    fail();
  },
  [1.5]() {
    fail();
  },
  [NaN]() {
    fail();
  },
  [0 / 0 + 1]() {
    fail();
  },
  [-0]() {
    fail();
  },
  [-Infinity]() {
    fail();
  },
  [1e21]() {
    fail();
  },
  ["k"]() {
    fail();
  },
  [""]() {
    fail();
  },
  ["two words"]() {
    fail();
  },
  ["a" + "b"]() {
    fail();
  },
  [`t`]() {
    fail();
  },
  [`t${1}`]() {
    fail();
  },
  ["__proto__"]() {
    fail();
  },
  ["p"]() {
    fail();
  },
  ["s" as string]() {
    fail();
  },
  [true ? "c" : "d"]() {
    fail();
  },
  [typeof 1]() {
    fail();
  },
  [constantText]() {
    fail();
  },
  [Color.Red + 100]() {
    fail();
  },
  [Color.Green]() {
    fail();
  },
  [Fixed.One + 200]() {
    fail();
  },
  [Fixed.Text]() {
    fail();
  },
  [Symbol.iterator]() {
    fail();
  },
  [Symbol.asyncIterator]() {
    fail();
  },
  [described]() {
    fail();
  },
  written() {
    fail();
  },
  8() {
    fail();
  },
  "quoted"() {
    fail();
  },
});

showMembers("values", {
  ["arrow"]: () => {
    fail();
  },
  ["function"]: function () {
    fail();
  },
  ["named"]: function own() {
    fail();
  },
  ["class"]: class {
    constructor() {
      fail();
    }
  },
  ["derived"]: class extends Object {
    constructor() {
      super();
      fail();
    }
  },
  ["named class"]: class Own {
    constructor() {
      fail();
    }
  },
  ["class with a name"]: class {
    static name = "static";
    constructor() {
      fail();
    }
  },
  ["parenthesized"]: () => {
    fail();
  },
  ["async arrow"]: async () => {},
  ["async function"]: async function () {},
  ["generator function"]: function* () {
    fail();
  },
  ["async generator function"]: async function* () {},
  [1]: () => {
    fail();
  },
  [2]: class {
    constructor() {
      fail();
    }
  },
  [NaN]: function () {
    fail();
  },
  [Symbol.iterator]: () => {
    fail();
  },
  [Symbol.hasInstance]: class {
    constructor() {
      fail();
    }
  },
  writtenArrow: () => {
    fail();
  },
  writtenClass: class {
    constructor() {
      fail();
    }
  },
});

showMembers("kinds of methods", {
  async ["async"]() {},
  *["generator"]() {
    fail();
  },
  async *["async generator"]() {},
  get ["accessor"]() {
    return fail();
  },
  set ["accessor"](value) {
    fail();
  },
  get [3]() {
    return fail();
  },
  set [3](value) {
    fail();
  },
  get [Symbol.toStringTag]() {
    return fail();
  },
});

class Members {
  ["method"]() {
    fail();
  }
  [4]() {
    fail();
  }
  [NaN]() {
    fail();
  }
  async ["async"]() {}
  *["generator"]() {
    fail();
  }
  async *["async generator"]() {}
  get ["accessor"]() {
    return fail();
  }
  set ["accessor"](value) {
    fail();
  }
  [Color.Green]() {
    fail();
  }
  [Symbol.iterator]() {
    fail();
  }
  written() {
    fail();
  }
  static ["method"]() {
    fail();
  }
  static [5]() {
    fail();
  }
  static *["generator"]() {
    fail();
  }
  static get ["accessor"]() {
    return fail();
  }
  static set ["accessor"](value) {
    fail();
  }
  static [Symbol.iterator]() {
    fail();
  }
  static written() {
    fail();
  }
}
showMembers("members", Members.prototype, new Members());
showMembers("static members", Members);

class Fields {
  ["arrow"] = () => {
    fail();
  };
  ["function"] = function () {
    fail();
  };
  ["class"] = class {
    constructor() {
      fail();
    }
  };
  [6] = () => {
    fail();
  };
  [Symbol.iterator] = () => {
    fail();
  };
  written = () => {
    fail();
  };
  static ["arrow"] = () => {
    fail();
  };
  static ["function"] = function () {
    fail();
  };
  static ["class"] = class {
    constructor() {
      fail();
    }
  };
  static [9] = () => {
    fail();
  };
  static written = () => {
    fail();
  };
}
showMembers("fields", new Fields());
showMembers("static fields", Fields);

function make(round: number) {
  return {
    ["made"]() {
      return round;
    },
    ["kept"]: () => round,
  };
}
const first = make(1);
const second = make(2);
console.log(first, second, first.made === second.made, first.made.name, second.kept.name, first.made(), second.kept());
Object.defineProperty(first.made, "name", { value: "renamed" });
console.log(first, first.made.name, second.made.name);

// FILE: host-classes/bodies-every-holder-parsed-alike.ts
// `await body.json()` gives the same whether or not it goes to a declared type, whatever holds the body: a string, bytes, a Blob, a stream of bytes or of strings, a file, a request or a response that came over the network.
// The bodies are drawn from a fixed seed: JSON that fits the type and JSON that does not, behind byte order marks of every kind, with lone surrogates, with bytes that are no UTF-8, cut short, blank and empty.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Order {
  id: number;
  name: string;
  tags?: string[];
  more?: { deep: boolean | null };
}

async function requestCast(body: Request): Promise<unknown> {
  return (await body.json()) as Order;
}
async function requestAnnotated(body: Request): Promise<unknown> {
  const order: Order = await body.json();
  return order;
}
async function requestReturned(body: Request): Promise<Order> {
  return await body.json();
}
async function responseCast(body: Response): Promise<unknown> {
  return (await body.json()) as Order;
}
async function responseAnnotated(body: Response): Promise<unknown> {
  const order: Order = await body.json();
  return order;
}
async function responseReturned(body: Response): Promise<Order> {
  return await body.json();
}
async function blobCast(body: Blob): Promise<unknown> {
  return (await body.json()) as Order;
}
async function blobAnnotated(body: Blob): Promise<unknown> {
  const order: Order = await body.json();
  return order;
}
async function blobReturned(body: Blob): Promise<Order> {
  return await body.json();
}
async function untyped(body: any): Promise<unknown> {
  return await body.json();
}

let state = 0x2545f491;
function below(limit: number): number {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) % limit;
}
const pick = <T>(list: readonly T[]): T => list[below(list.length)]!;

const inTexts = [
  "n",
  "",
  "é",
  "中文",
  "😀",
  "\ud800",
  "\udc00",
  "\udc00\ud800",
  "\ufeff",
  "\\ud800",
  "\\u0041\\n",
  "\u0000",
  "ï»¿",
  "a".repeat(40),
];
const inBytes = [
  [0x6e],
  [0xff],
  [0xc3, 0x28],
  [0xed, 0xa0, 0x80],
  [0xf0, 0x9f, 0x98, 0x80],
  [0xc0, 0x80],
  [0xe4, 0xb8],
  [0xef, 0xbb, 0xbf],
  [0xc3, 0xa9],
  [0xf4, 0x90, 0x80, 0x80],
];
const shapes = [
  '{"id":1,"name":"@"}',
  '{"id":1,"name":"@","tags":["@","x"],"more":{"deep":null}}',
  '{"name":"@","id":-0.5}',
  '{ "id" : 1 , "name" : "@" , "other" : [ "@" ] }',
  '{"id":"1","name":2,"@":"@"}',
  '{"id":1,"name":"@","id":2}',
  '["@"]',
  '"@"',
  "{}",
  "null",
  "5",
  "",
  " ",
  "\n",
  '{"id":1,"name":"@"',
  '{"id":1,"name":"@"}x',
  "@",
];
const marksOfTexts = ["", "", "", "\ufeff", "\ufeff\ufeff", "\ufffe", " \ufeff", "ï»¿", "ÿþ"];
const marksOfBytes = [
  [],
  [],
  [],
  [0xef, 0xbb, 0xbf],
  [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf],
  [0xff, 0xfe],
  [0xfe, 0xff],
  [0xef, 0xbb],
  [0xff],
  [0xff, 0xfe, 0xff, 0xfe],
  [0x00],
  [0xff, 0xfe, 0x00, 0x00],
];

const encoder = new TextEncoder();
function drawText(): string {
  return pick(marksOfTexts) + pick(shapes).replaceAll("@", () => pick(inTexts));
}
function drawBytes(): Uint8Array<ArrayBuffer> {
  const mark = pick(marksOfBytes);
  if (below(4) === 0) {
    const text = drawText();
    const wide: number[] = [];
    for (let at = 0; at < text.length; at++) wide.push(text.charCodeAt(at) & 0xff, text.charCodeAt(at) >> 8);
    return new Uint8Array([...mark, ...wide, ...(below(4) === 0 ? [0x7d] : [])]);
  }
  const parts = pick(shapes).split("@");
  return new Uint8Array([
    ...mark,
    ...parts.flatMap((part, at) => [...(at > 0 ? pick(inBytes) : []), ...encoder.encode(part)]),
  ]);
}
function streamOf(chunks: (string | Uint8Array<ArrayBuffer>)[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}
function cut<T extends string | Uint8Array<ArrayBuffer>>(whole: T, at: number): T[] {
  return [whole.slice(0, at), whole.slice(at)] as T[];
}

const folder = mkdtempSync(join(tmpdir(), "bodies-"));
const file = join(folder, "body.json");
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const way = new URL(request.url).pathname;
    if (way === "/echo") return new Response(await request.bytes());
    return Response.json(
      await tell(() =>
        way === "/cast"
          ? requestCast(request)
          : way === "/annotated"
            ? requestAnnotated(request)
            : way === "/returned"
              ? requestReturned(request)
              : untyped(request),
      ),
    );
  },
});

async function tell(read: () => Promise<unknown>): Promise<string> {
  try {
    const value = await read();
    return (
      JSON.stringify(value) +
      " " +
      (typeof value === "object" && value !== null ? Reflect.ownKeys(value).map(String).join() : typeof value)
    );
  } catch (error) {
    return "threw " + (error as Error).name + ": " + (error as Error).message;
  }
}

type Body = string | Uint8Array<ArrayBuffer>;
type Read = (body: Body, at: number) => Promise<unknown>;
const post = (body: BodyInit) => ({ method: "POST", body });
const requests: [string, (body: Body, at: number) => Request][] = [
  ["a request", body => new Request("http://localhost/", post(body))],
  ["a request over a blob", body => new Request("http://localhost/", post(new Blob([body])))],
  ["a request over a stream", body => new Request("http://localhost/", post(streamOf([body])))],
  ["a copy of a request", body => new Request("http://localhost/", post(body)).clone()],
];
const responses: [string, (body: Body, at: number) => Response | Promise<Response>][] = [
  ["a response", body => new Response(body)],
  ["a response over a blob", body => new Response(new Blob([body]))],
  ["a response over a stream", (body, at) => new Response(streamOf(cut(body, at)))],
  ["a response whose stream was taken", body => new Response(new Response(body).body)],
  ["a copy of a response", body => new Response(body).clone()],
  ["a response over a file", body => (writeFileSync(file, body), new Response(Bun.file(file)))],
  ["a response of fetch", body => fetch(server.url + "echo", post(body))],
];
const blobs: [string, (body: Body, at: number) => Blob][] = [
  ["a blob", body => new Blob([body])],
  ["a blob of two parts", (body, at) => new Blob(cut(body, at))],
  ["a part of a blob", body => new Blob(["{", body, "}"]).slice(1, -1)],
  ["a file", body => (writeFileSync(file, body), Bun.file(file))],
];

let differences = 0;
async function sweep(name: string, readers: [Read, Read, Read, Read]) {
  let digest = 0;
  let thrown = 0;
  for (let round = 0; round < 240; round++) {
    const body = round % 2 === 0 ? drawText() : drawBytes();
    const at = below(body.length + 1);
    const answers: string[] = [];
    for (const read of readers) answers.push(await tell(() => read(body, at)));
    if (answers.some(answer => answer !== answers[3]) && differences++ < 20)
      console.log(
        name,
        "DIFFERS for",
        typeof body === "string" ? JSON.stringify(body) : Array.from(body, byte => byte.toString(16)).join(" "),
        answers,
      );
    if (answers[3]!.startsWith("threw")) thrown++;
    for (const answer of answers)
      for (let at = 0; at < answer.length; at++) digest = (Math.imul(digest, 31) + answer.charCodeAt(at)) | 0;
  }
  console.log(name + ":", thrown, "of 240 throw,", (digest >>> 0).toString(16));
}
for (const [name, make] of requests)
  await sweep(name, [
    (body, at) => requestCast(make(body, at)),
    (body, at) => requestAnnotated(make(body, at)),
    (body, at) => requestReturned(make(body, at)),
    (body, at) => untyped(make(body, at)),
  ]);
for (const [name, make] of responses)
  await sweep(name, [
    async (body, at) => responseCast(await make(body, at)),
    async (body, at) => responseAnnotated(await make(body, at)),
    async (body, at) => responseReturned(await make(body, at)),
    async (body, at) => untyped(await make(body, at)),
  ]);
for (const [name, make] of blobs)
  await sweep(name, [
    (body, at) => blobCast(make(body, at)),
    (body, at) => blobAnnotated(make(body, at)),
    (body, at) => blobReturned(make(body, at)),
    (body, at) => untyped(make(body, at)),
  ]);
const asked =
  (way: string): Read =>
  async body =>
    JSON.parse(await (await fetch(server.url + way, post(body))).text());
await sweep("a request of a server", [asked("cast"), asked("annotated"), asked("returned"), asked("untyped")]);
console.log(differences, "differences");
server.stop(true);
rmSync(folder, { recursive: true });

// FILE: stress/one-odd-line-more/own.js
// The program that the files beside it import: it stays the same, and each of them adds one odd line.
export class Vec {
  constructor(x, y) { this.x = x; this.y = y; }
  add(o) { return new Vec(this.x + o.x, this.y + o.y); }
  scale(k) { return new Vec(this.x * k, this.y * k); }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y); }
}
export class Body {
  constructor(name, pos, vel) { this.name = name; this.pos = pos; this.vel = vel; this.tags = []; this.hits = 0; }
  step(dt) { this.pos = this.pos.add(this.vel.scale(dt)); this.hits++; return this; }
  describe() { return this.name + ":" + this.pos.len().toFixed(2); }
  weight() { return 1; }
}
export class Heavy extends Body {
  constructor(name, pos, vel, mass) { super(name, pos, vel); this.mass = mass; }
  describe() { return super.describe() + "@" + this.mass; }
  weight() { return this.mass; }
}
export class Ghost extends Body {
  constructor(name, pos, vel) { super(name, pos, vel); this.seen = false; }
  weight() { return 0; }
}
export const options = { dt: 0.5, rounds: 20, label: "world", verbose: false };
export const handlers = new Map();
export function on(name, fn) { let list = handlers.get(name); if (!list) handlers.set(name, (list = [])); list.push(fn); }
export function emit(name, body) { const list = handlers.get(name); if (list) for (let i = 0; i < list.length; i++) list[i](body); }
export function makeWorld(n) {
  const world = [];
  for (let i = 0; i < n; i++) {
    const p = new Vec(i, i * 2), v = new Vec(1, -1);
    world.push(i % 3 === 0 ? new Heavy("h" + i, p, v, i + 1) : i % 3 === 1 ? new Ghost("g" + i, p, v) : new Body("b" + i, p, v));
  }
  return world;
}
export const stats = { steps: 0, weight: 0, longest: "", byKind: { heavy: 0, ghost: 0, plain: 0 } };
export function count(body) {
  stats.steps++; stats.weight += body.weight();
  if (body instanceof Heavy) stats.byKind.heavy++; else if (body instanceof Ghost) stats.byKind.ghost++; else stats.byKind.plain++;
  const text = body.describe(); if (text.length > stats.longest.length) stats.longest = text;
}
export function run(world, opts) {
  for (let r = 0; r < opts.rounds; r++) for (let i = 0; i < world.length; i++) { const b = world[i].step(opts.dt); emit("step", b); if (b.hits === 3) b.tags.push(opts.label); }
  return world;
}
export function summary(world) {
  let out = "";
  for (const b of world) out += b.describe() + (b.tags.length ? "#" + b.tags[0] : "") + ";";
  return out + stats.steps + "/" + stats.weight + "/" + stats.longest + "/" + stats.byKind.heavy + stats.byKind.ghost + stats.byKind.plain;
}
export const world = makeWorld(9);
on("step", count);
on("step", b => { if (b.pos.x > 1e9) b.vel = new Vec(0, 0); });

// FILE: stress/one-odd-line-more/throw-caught.js
// One odd line that never runs stands beside a program that does not change: throw caught. It prints what plain Bun prints.
import { Vec, Body, Heavy, Ghost, options, handlers, on, emit, makeWorld, stats, count, run, summary, world } from "./own.js";
const K = process.argv[2];
if (process.argv.length > 99) {
  try { throw world[0]; } catch (e) { console.log(e.hits); }
}
console.log(summary(run(world, options)));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Process
// CHECK-NEXT: v1 = PropGet v0 key="env"
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="PROGRAM"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = ImportDynamic v4 referrer=[[m_0]]
// CHECK-NEXT: v6 = Await v5
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }

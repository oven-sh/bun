// A table, no seeds: an object that the platform makes (a Buffer, a URL, a Request, an event, a stream ..) reaches a function through hands that nobody follows, and there every accessor up its prototype chain is read under a key that only the run knows.
//
//   the object x the hands it comes through x the way a member is read
//
// One case to a program: a program that reads the members of the object in a second way would answer for the first as well. The kinds of the values are printed, not the values.
type Named = { name: string; text: string };

/** `text` makes the object. `imports` stands at the top of the file. */
const subjects: readonly (Named & { imports?: string })[] = [
  { name: "a Buffer", text: 'Buffer.from("abc")' },
  { name: "a slice of a Buffer", text: 'Buffer.from("abcdef").subarray(2, 4)' },
  { name: "a URL", text: 'new URL("http://user:word@host:81/path?query=1#hash")' },
  { name: "URLSearchParams", text: 'new URLSearchParams("a=1&b=2")' },
  { name: "a Request", text: 'new Request("http://host/path", { method: "POST", body: "text" })' },
  { name: "a Response", text: 'new Response("text", { status: 201 })' },
  { name: "Headers", text: 'new Headers({ a: "1" })' },
  { name: "an Event", text: 'new Event("kind")' },
  { name: "a CustomEvent", text: 'new CustomEvent("kind", { detail: 1 })' },
  { name: "an EventTarget", text: "new EventTarget()" },
  { name: "an AbortController", text: "new AbortController()" },
  { name: "an AbortSignal", text: "new AbortController().signal" },
  { name: "a Blob", text: 'new Blob(["text"], { type: "text/plain" })' },
  { name: "a TextEncoder", text: "new TextEncoder()" },
  { name: "a TextDecoder", text: "new TextDecoder()" },
  { name: "FormData", text: "new FormData()" },
  { name: "a ReadableStream", text: "new ReadableStream()" },
  { name: "a WritableStream", text: "new WritableStream()" },
  { name: "a MessageChannel's port", text: "new MessageChannel().port1" },
  { name: "a typed array", text: "new Uint8Array(2)" },
  { name: "a DataView", text: "new DataView(new ArrayBuffer(4), 1)" },
  { name: "an ArrayBuffer", text: "new ArrayBuffer(4)" },
  { name: "a Map", text: "new Map([[1, 2]])" },
  { name: "a Set", text: "new Set([1])" },
  { name: "a regular expression", text: "/a/gi" },
  { name: "a symbol's wrapper", text: 'Object(Symbol("described"))' },
  { name: "an Intl.NumberFormat", text: 'new Intl.NumberFormat("en")' },
  { name: "an Intl.Locale", text: 'new Intl.Locale("en-US")' },
  { name: "an EventEmitter", imports: 'import { EventEmitter as Made } from "node:events";', text: "new Made()" },
  { name: "a Readable", imports: 'import { Readable as Made } from "node:stream";', text: "new Made({ read() {} })" },
  { name: "a Writable", imports: 'import { Writable as Made } from "node:stream";', text: "new Made({ write() {} })" },
  { name: "a PassThrough", imports: 'import { PassThrough as Made } from "node:stream";', text: "new Made()" },
  {
    name: "a StringDecoder",
    imports: 'import { StringDecoder as Made } from "node:string_decoder";',
    text: "new Made()",
  },
  { name: "a Hash", imports: 'import { createHash } from "node:crypto";', text: 'createHash("sha1")' },
  { name: "a Stats", imports: 'import { statSync } from "node:fs";', text: 'statSync(".")' },
];

/** `V` makes the object, `look` is the function that reads it; it is called once. What `declares` stands in front. */
const hands: readonly (Named & { declares?: string })[] = [
  { name: "a plain call", text: "look(V);" },
  { name: "a listener of an EventEmitter", declares: 'import { EventEmitter } from "node:events";', text: 'const emitter = new EventEmitter(); emitter.on("x", look); emitter.emit("x", V);' }, // prettier-ignore
  { name: "a listener of an EventTarget", text: 'const target = new EventTarget(); target.addEventListener("x", event => look(event.detail)); target.dispatchEvent(new CustomEvent("x", { detail: V }));' }, // prettier-ignore
  { name: "a timer's argument", text: "setTimeout(look, 0, V);" },
  { name: "process.nextTick's argument", text: "process.nextTick(look, V);" },
  { name: "a callback of forEach", text: "[V].forEach(value => look(value));" },
  { name: "then", text: "Promise.resolve(V).then(look);" },
  { name: "a function of the platform named at run time", text: 'look(globalThis[process.argv[5] ?? "Object"](V));' },
  { name: "text made at run time", text: 'look(new Function("x", "return x")(V));' },
  { name: "Reflect.apply", text: "Reflect.apply(look, undefined, [V]);" },
  { name: "a bound function", text: "look.bind(null, V)();" },
  { name: "a Map's value", text: "look(new Map([[1, V]]).get(1));" },
  {
    name: "a resolver called as a method",
    text: "const made = Promise.withResolvers(); made.promise.then(look); made.resolve(V);",
  },
  { name: "a callback of native code", declares: 'import { randomBytes } from "node:crypto";', text: "const kept = V; randomBytes(1, () => look(kept));" }, // prettier-ignore
];

/** `v` is the object, `key` the key. */
const reads: readonly Named[] = [
  { name: "an index", text: "v[key]" },
  { name: "Reflect.get", text: "Reflect.get(v, key)" },
  { name: "a pattern", text: "(({ [key]: taken }) => taken)(v)" },
  { name: "the getter out of the descriptor", text: "Reflect.getOwnPropertyDescriptor(level, key).get.call(v)" },
];

const crossed = subjects.flatMap(subject => hands.flatMap(hand => reads.map(read => ({ subject, hand, read }))));

const laidOut = [[], ["--aot-testing=DelayFlowRules"], ["--aot-testing=DelayOtherFlowRules"]];
export const programs = laidOut.length * crossed.length;

/** The flags that the program of that number is built with. */
export const flagsOf = (index: number): string[] => laidOut[Math.floor(index / crossed.length)];

export function programOf(index: number): { file: string; text: string } {
  // Neighbors in the table differ in the way of reading alone: a stride that shares no factor with the length of the table takes a run's share from all over it.
  const { subject, hand, read } = crossed[((index % crossed.length) * 7919) % crossed.length];
  const label = `${subject.name} | ${hand.name} | ${read.name}`;
  return {
    file: "main.mjs",
    text: `${[subject.imports, hand.declares].filter(Boolean).join("\n")}
function look(v) {
  const said = [];
  for (let level = v; level !== null && level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    for (const key of Reflect.ownKeys(level)) {
      const own = Reflect.getOwnPropertyDescriptor(level, key);
      if (!own.get) continue;
      let kind;
      try {
        kind = typeof (${read.text});
      } catch (error) {
        kind = "throws " + error.constructor.name;
      }
      said.push(String(key) + (own.enumerable ? "" : "~") + ":" + kind);
    }
  }
  console.log(${JSON.stringify(label)} + ": " + said.join());
  process.exit(0);
}
${hand.text.replaceAll("V", subject.text)}
`.trimStart(),
  };
}

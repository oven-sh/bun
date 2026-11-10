// One value is printed: what it is, times the way by which it reaches the print, times how it is printed. Each program holds one of each and is built alone.
//
//   bun write-printed-value-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<value>--<way>--<print>.mjs
//   bun write-printed-value-sweep.ts count
//   bun write-printed-value-sweep.ts named <pattern> <folder> [most]
//
// An executable holds only the parts of the runtime that the build saw the program use. What prints an object is such a part, and which part is needed hangs on the value, which the build may not see: it came
// out of a list that was filled at run time, was thrown, or was handed on by `apply()`. Beside other programs one of them needs the part anyway, so the programs stand alone.
import { mkdirSync, writeFileSync } from "fs";

const values: [string, string][] = [
  ["a-url", `new URL("https://example.com/a?b=1")`],
  ["a-map", `new Map([["a", 1]])`],
  ["a-set", `new Set([1, "b"])`],
  ["a-date", `new Date(0)`],
  ["a-date-that-is-none", `new Date(NaN)`],
  ["a-pattern", `/a+b/gi`],
  ["an-instance", `new (class Point { x = 1; y = 2; })()`],
  ["an-instance-below-a-map", `new (class Table extends Map {})([["k", 2]])`],
  ["bytes", `new Uint8Array([1, 2, 3])`],
  ["doubles", `new Float64Array([1.5])`],
  ["a-buffer", `new ArrayBuffer(4)`],
  ["a-view", `new DataView(new ArrayBuffer(2))`],
  ["a-promise", `[Promise.resolve(7)]`],
  ["a-symbol", `Symbol("mark")`],
  ["a-big-integer", `12345678901234567890n`],
  ["an-arrow", `(a, b) => a + b`],
  ["a-class", `class Shape {\n}`],
  ["a-generator", `(function* () { yield 1; })()`],
  ["a-weak-map", `new WeakMap()`],
  ["search-parameters", `new URLSearchParams("a=1&b=2")`],
  ["headers", `new Headers({ a: "1" })`],
  ["a-node-buffer", `Buffer.from("abc")`],
  ["a-blob", `new Blob(["abc"])`],
  ["a-response", `new Response("x", { status: 201 })`],
  ["a-text-encoder", `new TextEncoder()`],
  ["records-in-records", `{ a: { b: { c: { d: 1 } } }, list: [1, [2, [3]]] }`],
  ["a-record-below-nothing", `Object.assign(Object.create(null), { a: 1 })`],
  ["a-proxy", `new Proxy({ a: 1 }, {})`],
  ["a-number-in-an-object", `new Number(3)`],
  ["a-text-in-an-object", `new String("s")`],
  ["a-record-with-a-getter", `{ get a() { return 1; } }`],
  ["a-record-with-a-symbol-key", `{ [Symbol("k")]: 1 }`],
  ["a-list-with-a-hole", `[1, , 3]`],
  ["a-record-that-holds-itself", `(() => { const ring = { name: "ring" }; ring.self = ring; return ring; })()`],
  ["an-arguments-object", `(function () { return arguments; })(1, 2)`],
  ["a-record-that-prints-itself", `{ [Symbol.for("nodejs.util.inspect.custom")]() { return "printed by itself"; } }`],
  ["a-tagged-record", `{ [Symbol.toStringTag]: "Tagged" }`],
  ["texts-with-quotes", `["a'b", 'c"d', "e\\nf"]`],
  ["minus-zero", `-0`],
  ["a-text", `"plain"`],
  ["a-readable-stream", `new ReadableStream()`],
  ["a-writable-stream", `new WritableStream()`],
  ["a-transform-stream", `new TransformStream()`],
  ["a-reader-of-a-stream", `new ReadableStream().getReader()`],
  ["a-writer-of-a-stream", `new WritableStream().getWriter()`],
  ["a-text-decoder-stream", `new TextDecoderStream()`],
  ["a-text-encoder-stream", `new TextEncoderStream()`],
  ["a-compression-stream", `new CompressionStream("gzip")`],
  ["a-decompression-stream", `new DecompressionStream("gzip")`],
  ["a-count-queuing-strategy", `new CountQueuingStrategy({ highWaterMark: 2 })`],
  ["a-byte-length-queuing-strategy", `new ByteLengthQueuingStrategy({ highWaterMark: 16 })`],
  ["an-event-target", `new EventTarget()`],
  ["an-abort-signal", `new AbortController().signal`],
  ["form-data", `new FormData()`],
  ["a-request", `new Request("https://example.com/")`],
  ["a-file", `new File(["a"], "a.txt", { lastModified: 0 })`],
  ["a-text-decoder", `new TextDecoder()`],
  ["a-number-format", `new Intl.NumberFormat("en")`],
  ["a-weak-reference", `new WeakRef({})`],
  ["a-shared-buffer", `new SharedArrayBuffer(2)`],
  ["big-integers", `new BigInt64Array(1)`],
  ["a-date-format", `new Intl.DateTimeFormat("en", { timeZone: "UTC" })`],
];

// `show` prints what it is given. It is first seen to be given a text; then the value reaches it.
const ways: [string, (value: string) => string][] = [
  ["where-it-is-made", value => `show(${value});`],
  ["out-of-a-variable", value => `const kept = ${value};\nshow(kept);`],
  [
    "out-of-a-list-from-data-by-for-each",
    value => `const list = JSON.parse("[]");\nlist[0] = ${value};\nlist.forEach(show);`,
  ],
  [
    "out-of-a-list-from-data-by-its-place",
    value => `const list = JSON.parse("[]");\nlist[0] = ${value};\nshow(list[0]);`,
  ],
  ["out-of-a-written-list-by-for-each", value => `[${value}].forEach(show);`],
  ["out-of-a-written-list-by-for-of", value => `for (const one of [${value}]) show(one);`],
  [
    "out-of-a-record-from-data-under-a-key-from-data",
    value => `const record = JSON.parse("{}"), key = JSON.parse('"k"');\nrecord[key] = ${value};\nshow(record[key]);`,
  ],
  ["out-of-a-map-by-for-each", value => `new Map([["k", ${value}]]).forEach(show);`],
  ["out-of-a-function-kept-in-a-list", value => `const makers = [() => ${value}];\nshow(makers[0]());`],
  [
    "thrown-and-caught",
    value => `try {\n  throw ${value.replace(/\n/g, "\n  ")};\n} catch (caught) {\n  show(caught);\n}`,
  ],
  ["handed-to-then", value => `await Promise.resolve([${value}]).then(all => all[0]).then(show);`],
  ["handed-on-by-apply", value => `show.apply(null, [${value}]);`],
  ["handed-on-by-reflect", value => `Reflect.apply(show, null, JSON.parse("[]").concat([${value}]));`],
  ["handed-on-by-a-bound-function", value => `show.bind(null, ${value})();`],
  ["off-the-global-object", value => `globalThis.kept = ${value};\nshow(globalThis.kept);`],
  ["inside-a-list-from-data", value => `const list = JSON.parse("[1]");\nlist.push(${value});\nshow(list);`],
  [
    "by-a-function-found-under-a-key-from-data",
    value => `const table = { show };\ntable[JSON.parse('"show"')](${value});`,
  ],
  [
    "by-a-callback-of-a-timer",
    value =>
      `function late(one, done) {\n  try {\n    show(one);\n  } finally {\n    done();\n  }\n}\nawait new Promise(done => setTimeout(late, 0, ${value}, done));`,
  ],
];

// What stands in front of the program, and the statement that prints `x`.
const prints: [string, string, string][] = [
  ["log", "", `console.log(x);`],
  ["log-behind-a-text", "", `console.log("said", x);`],
  ["log-by-percent-o", "", `console.log("%o", x);`],
  ["log-by-percent-s", "", `console.log("%s", x);`],
  ["info", "", `console.info(x);`],
  ["debug", "", `console.debug(x);`],
  ["dir", "", `console.dir(x);`],
  ["table", "", `console.table(x);`],
  ["inspect-of-util", `import { inspect } from "node:util";\n`, `console.log(inspect(x));`],
  ["format-of-util", `import { format } from "node:util";\n`, `console.log(format("%O|%s", x, x));`],
  ["inspect-of-bun", "", `console.log(Bun.inspect(x));`],
  ["string", "", `console.log(String(x));`],
  ["a-template", "", "console.log(`<${x}>`);"],
  ["json", "", `console.log(JSON.stringify(x));`],
  ["its-tag", "", `console.log(Object.prototype.toString.call(x));`],
  ["a-console-of-its-own", `import { Console } from "node:console";\n`, `new Console(process.stdout).log(x);`],
];

const all = values.length * ways.length * prints.length;

function write(at: number): { name: string; text: string } {
  const [value, make] = values[at % values.length];
  const [way, reach] = ways[Math.floor(at / values.length) % ways.length];
  const [print, front, statement] = prints[Math.floor(at / values.length / ways.length)];
  const written = make.startsWith("{") || make.startsWith("(a, b)") || make.startsWith("class ") ? `(${make})` : make;
  const text = `${front}function show(x) {
  ${statement}
}
show("first");
${reach(written)}
console.log("the end");
export {};
`;
  return { name: `${value}--${way}--${print}.mjs`, text };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}

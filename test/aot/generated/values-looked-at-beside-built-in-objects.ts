import { aotBuiltinEntries } from "bun:internal-for-testing";

// A value whose kind the compiler knows is looked at beside a built-in object: compared with it, tested against it, or handed on with it. The arm that hangs on the answer is one that never runs.
// Other built-ins are called with the value ahead of that, and members of the value are read behind it.
const objectKinds = ["Namespace", "Constructor", "Function", "Prototype", "Method"];
const isWritable = (path: string) => /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(path);
function isThere(path: string) {
  let value: unknown = globalThis;
  for (const name of path.split(".")) {
    const descriptor = Object.getOwnPropertyDescriptor(value as object, name);
    if (!descriptor || !("value" in descriptor || value === globalThis)) return false;
    value = "value" in descriptor ? descriptor.value : (value as Record<string, unknown>)[name];
    if (typeof value !== "function" && (typeof value !== "object" || value === null)) return false;
  }
  return true;
}
/** Every object of the compiler's table of built-ins that a program can write as a path from a global, and that the running Bun has. */
export const builtIns: string[] = aotBuiltinEntries()
  .entries.filter(entry => objectKinds.includes(entry.kind) && isWritable(entry.path) && isThere(entry.path))
  .map(entry => entry.path)
  .sort();

export const values: Record<string, [made: string, ahead: string, behind: string]> = {
  "a list": ["[1, 2, 3]", "Object.keys(v).join()", "v.length"],
  "a list of texts": ['["a", "b"]', "Array.isArray(v)", "v.join()"],
  "a map": ['new Map([["a", 1]])', "Object.keys(v).length", "v.size"],
  "a set": ["new Set([1, 2])", "Object.keys(v).length", "v.size"],
  "a regular expression": ["/a+/g", "Object.keys(v).length", "v.source + v.flags"],
  "a date": ["new Date(86400000)", "Object.keys(v).length", "v.getTime()"],
  "an error": ['new TypeError("no")', "Object.keys(v).length", "v.message"],
  "bytes": ["new Uint8Array([1, 2, 3, 4])", "Object.keys(v).join()", "v.byteLength"],
  "a buffer": ["new ArrayBuffer(8)", "ArrayBuffer.isView(v)", "v.byteLength"],
  "a promise": ["Promise.resolve(1)", "Object.keys(v).length", "typeof v.then"],
  "a boxed number": ["new Number(5)", "Object.keys(v).length", "v.valueOf()"],
  "a literal": ["{ a: 1, b: 2 }", "Object.keys(v).join()", "v.a + v.b"],
  "an instance": ["new (class Point { x = 1; y = 2; })()", "Object.keys(v).join()", "v.x + v.y"],
  "a function": ["function named(a, b) {}", "Object.keys(v).length", "v.length + v.name"],
  "a text": ['"text"', "Object.keys(v).join()", "v.length"],
  "a url": ['new URL("http://localhost/a")', "Object.keys(v).length", "v.pathname"],
};

export const looks: Record<string, (builtIn: string) => string> = {
  "compared": builtIn => `if (v === ${builtIn}) console.log("same");`,
  "compared the other way round": builtIn => `if (${builtIn} === v) console.log("same");`,
  "compared loosely": builtIn =>
    `try { if (v == ${builtIn}) console.log("same"); } catch (error) { console.log("THROWS", error.constructor.name); }`,
  "compared for a difference": builtIn => `if (v !== ${builtIn}) console.log("other"); else console.log("same");`,
  "a case of a switch": builtIn => `switch (v) { case ${builtIn}: console.log("same"); }`,
  "compared in a condition": builtIn => `console.log(v === ${builtIn} ? "same" : "other");`,
  "compared behind a test of the kind": builtIn =>
    `if (typeof ${builtIn} === typeof v && v === ${builtIn}) console.log("same");`,
  "an instance of it": builtIn =>
    `try { if (v instanceof ${builtIn}) console.log("instance"); } catch (error) { console.log("THROWS", error.constructor.name); }`,
  "a key in it": builtIn =>
    `try { if ("no such key" in ${builtIn} && v === ${builtIn}) console.log("same"); } catch (error) { console.log("THROWS", error.constructor.name); }`,
  "handed on with it": builtIn => `if (Object.is(v, ${builtIn})) console.log("same");`,
  "handed to a function of the program with it": builtIn =>
    `if (((a, b) => a === b)(v, ${builtIn})) console.log("same");`,
  "compared in a loop": builtIn => `for (let i = 0; i < 3; i++) if (v === ${builtIn}) console.log("same");`,
};

export const textOf = (builtIn: string, look: string) =>
  Object.entries(values)
    .map(
      ([name, [made, ahead, behind]]) =>
        `{ const v = ${made}; console.log(${JSON.stringify(name)}, ${ahead}); ${looks[look](builtIn)} console.log(${behind}); }`,
    )
    .join("\n") + "\n";

export const textOfOne = (builtIn: string, look: string, value: string) => {
  const [made, ahead, behind] = values[value];
  return `const v = ${made}; console.log(${ahead}); ${looks[look](builtIn)} console.log(${behind});\n`;
};

const testsForClasses = [
  "Array.isArray(x)",
  "ArrayBuffer.isView(x)",
  "Error.isError(x)",
  'typeof x === "function"',
  'typeof x === "object"',
  ...["Array", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Promise", "RegExp", "Date", "Error", "TypeError", "ArrayBuffer", "DataView", "Uint8Array", "Buffer", "Function", "Boolean", "Number", "String", "Object", "EventTarget", "Performance", "Event", "URL", "Headers", "Request", "Response", "Blob", "AbortSignal", "ReadableStream", "TextDecoder", "EventEmitter"].map(name => `x instanceof ${name}`), // prettier-ignore
];

/** The object itself comes from where the compiler cannot follow it, passes what tests for a class it passes, and is compared with itself behind each. */
export const textOfItself = (builtIn: string) => `import { EventEmitter } from "node:events";
const hide = v => new CustomEvent("x", { detail: v }).detail;
function look(x) {
${testsForClasses.map(test => `  if (${test}) console.log(${JSON.stringify(test)}, x === ${builtIn}, ${builtIn} === x, Object.is(x, ${builtIn}));`).join("\n")}
}
look(hide(${builtIn}));
look(${builtIn});
for (const other of [[1], new Map(), new Set(), /a/, new Date(0), new TypeError("no"), new Uint8Array(1), Promise.resolve(1), new EventTarget(), new EventEmitter(), () => {}, {}]) look(hide(other));
`;

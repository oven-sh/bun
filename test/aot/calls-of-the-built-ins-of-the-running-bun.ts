// Programs that call built-ins on receivers of their own class with odd and with meddling arguments, ask in place what came back, and print the receiver as the call left it.
// A meddling argument changes the receiver while it is converted: it shrinks or grows the list, changes the kind of its storage, resizes or detaches the buffer. The classes are those whose
// methods work out a place in memory from an argument. The methods are those of the Bun that runs this file. Each call stands in functions of its own, with a fresh receiver.
//
//   bun calls-of-the-built-ins-of-the-running-bun.ts           prints the programs as JSON

const odd = [
  "undefined",
  "null",
  "-0",
  "1",
  "-1",
  "7",
  "1.5",
  "NaN",
  "Infinity",
  "2147483648",
  "-2147483649",
  "4294967296",
  `"1"`,
  `"a"`,
  "1n",
  "{}",
  "[1, 2, 3]",
  "(x) => x",
  "Symbol.iterator",
  "{ valueOf() { return 1; } }",
  "new Uint8Array([9, 8])",
];
const isLarge = (text: string) => /^-?(\d{6,}|Infinity)$/.test(text);
// These make something as long as a number says.
const makesThatMany = /^(repeat|padStart|padEnd|resize|transfer|transferToFixedLength|fill)$/;
// What these answer is of the machine or of the text of a function, or they wait.
const leftOut =
  /^(constructor|wait|waitAsync|toString|toLocaleString|inspect|localeCompare|normalize|toLocaleLowerCase|toLocaleUpperCase)$/;

interface Kind {
  name: string;
  holder: object;
  call(method: string, passed: string): string;
  receivers: string[];
  meddlers: string[];
  first: string;
}

const onReceiver = (method: string, passed: string) =>
  /^[A-Za-z_$][\w$]*$/.test(method) ? `o.${method}(${passed})` : `o[${method}](${passed})`;
const listMeddlers = [
  "{ valueOf() { o.length = 0; return 1; } }",
  "{ valueOf() { o.length = 1; return 2; } }",
  "{ valueOf() { o[0] = 1.5; return 0; } }",
  `{ valueOf() { o[0] = "s"; return 0; } }`,
  "{ valueOf() { o[0] = {}; return 1; } }",
  "{ valueOf() { for (let i = 0; i < 40; i++) o.push(i); return 1; } }",
  "{ valueOf() { o[2000] = 1; return 1; } }",
  "{ valueOf() { delete o[1]; return 1; } }",
  "{ valueOf() { o.shift(); return 1; } }",
  `{ toString() { o.length = 0; return "1"; } }`,
  "{ valueOf() { Object.freeze(o); return 1; } }",
  "{ valueOf() { Object.defineProperty(o, 1, { get() { return 77; }, configurable: true }); return 0; } }",
];
const bufferMeddlers = [
  "{ valueOf() { b.resize(0); return 0; } }",
  "{ valueOf() { b.resize(4); return 1; } }",
  "{ valueOf() { b.resize(32); return 20; } }",
  "{ valueOf() { b.transfer(); return 0; } }",
  "{ valueOf() { b.transfer(); return 1; } }",
  "{ valueOf() { b.resize(1); return 4; } }",
];
const resizable =
  "const b = new ArrayBuffer(16, { maxByteLength: 32 }); new Uint8Array(b).set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);";

const kinds: Kind[] = [
  {
    name: "Array",
    holder: Array.prototype,
    call: onReceiver,
    first: "1",
    meddlers: listMeddlers,
    receivers: ["const o = [1, 2, 3];", "const o = [1.5, 2.5, -0];", `const o = ["a", , {}];`],
  },
  {
    name: "typed arrays",
    holder: Object.getPrototypeOf(Uint8Array.prototype),
    call: onReceiver,
    first: "1",
    meddlers: bufferMeddlers,
    receivers: [
      `${resizable} const o = new Uint8Array(b);`,
      `${resizable} const o = new Float64Array(b);`,
      `${resizable} const o = new Int32Array(b, 4, 2);`,
      `${resizable} const o = new BigInt64Array(b, 8);`,
    ],
  },
  {
    name: "DataView",
    holder: DataView.prototype,
    call: onReceiver,
    first: "0",
    meddlers: bufferMeddlers,
    receivers: [`${resizable} const o = new DataView(b);`, `${resizable} const o = new DataView(b, 4, 8);`],
  },
  {
    name: "Atomics",
    holder: Atomics,
    call: (method, passed) => `Atomics.${method}(o${passed ? ", " + passed : ""})`,
    first: "0",
    meddlers: bufferMeddlers,
    receivers: [
      `${resizable} const o = new Int32Array(b);`,
      `${resizable} const o = new BigInt64Array(b);`,
      "const b = new SharedArrayBuffer(16); const o = new Int16Array(b, 8);",
    ],
  },
  {
    name: "Buffer",
    holder: Buffer.prototype,
    call: onReceiver,
    first: "0",
    meddlers: bufferMeddlers,
    receivers: [`${resizable} const o = Buffer.from(b);`, `${resizable} const o = Buffer.from(b, 4, 8);`],
  },
  {
    name: "ArrayBuffer",
    holder: ArrayBuffer.prototype,
    call: onReceiver,
    first: "1",
    meddlers: ["{ valueOf() { o.resize(0); return 1; } }", "{ valueOf() { o.transfer(); return 1; } }"],
    receivers: ["const o = new ArrayBuffer(16, { maxByteLength: 32 });", "const o = new ArrayBuffer(8);"],
  },
  {
    name: "String",
    holder: String.prototype,
    call: onReceiver,
    first: "1",
    meddlers: [],
    receivers: [`const o = "abc";`, `const o = "\\ud800\\u65e5";`, `const o = "a" + String(1) + "c";`],
  },
];

const prelude = `const say = (...words) => console.log(words.join(" "));
function show(v, depth = 0) {
  if (typeof v === "string") return v.length > 60 ? "string of " + v.length : JSON.stringify(v);
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "symbol") return String(v);
  if (typeof v === "function") return "function " + v.name + "/" + v.length;
  if (v === null || typeof v !== "object") return String(v);
  const tag = Object.prototype.toString.call(v);
  if (depth > 1) return tag;
  const some = list => list.map(each => show(each, depth + 1)).join(",");
  if (Array.isArray(v)) { const out = []; for (let i = 0; i < v.length && i < 8; i++) out.push(i in v ? show(v[i], depth + 1) : "hole"); return "[" + v.length + ": " + out.join(",") + "]" + (Object.isFrozen(v) ? " frozen" : ""); }
  if (v instanceof DataView) { try { return tag + v.byteOffset + "+" + v.byteLength; } catch { return tag + " out of bounds"; } }
  if (ArrayBuffer.isView(v)) return tag + v.byteOffset + "+" + v.length + ": " + some(Array.prototype.slice.call(v, 0, 17));
  if (v instanceof ArrayBuffer) return tag + v.byteLength + (v.detached ? " detached" : ": " + some(Array.prototype.slice.call(new Uint8Array(v), 0, 17)));
  return tag + " {" + Object.keys(v).slice(0, 6).map(key => key + ":" + show(v[key], depth + 1)).join(",") + "}";
}`;

// The type of what the second function returns hangs on what the compiler believes of the result.
function writeCall(receiver: string, call: string, n: number): string {
  return `function asked${n}() {
  ${receiver}
  let r;
  try { r = ${call}; } catch (error) { return "threw " + error.name + " | " + show(o); }
  return "" + +(typeof r === "undefined") + +(typeof r === "boolean") + +(typeof r === "number") + +(typeof r === "string") + +(typeof r === "bigint") + +(typeof r === "function") + +(typeof r === "object") + +(r === null) + (typeof r === "number" ? " " + +((r | 0) === r) + +(r !== r) + +Object.is(r, -0) + +(r >= 0) : "") + (typeof r === "string" ? " " + r.length : "") + (Array.isArray(r) ? " " + r.length + typeof r[0] : "") + " " + show(r) + " | " + show(o);
}
function returned${n}() {
  ${receiver}
  let r;
  try { r = ${call}; } catch { return "threw"; }
  if (typeof r === "number") return r;
  if (typeof r === "string") return r.length;
  if (r === undefined) return "undefined";
  if (typeof r === "boolean") return r ? 1.5 : -1.5;
  if (typeof r === "object") return [r];
  return typeof r;
}
say(${JSON.stringify(receiver.replace(resizable, "").trim() + " " + call)}, "=", asked${n}(), "=", show(returned${n}()));`;
}

if (import.meta.main) {
  const wellKnownSymbols = new Map<symbol, string>();
  for (const name of Object.getOwnPropertyNames(Symbol))
    if (typeof (Symbol as any)[name] === "symbol") wellKnownSymbols.set((Symbol as any)[name], "Symbol." + name);
  const programs: { name: string; calls: number; program: string }[] = [];
  for (const kind of kinds) {
    const methods = Reflect.ownKeys(kind.holder)
      .filter(key => (typeof key === "string" ? !leftOut.test(key) : wellKnownSymbols.has(key)))
      .filter(key => typeof Object.getOwnPropertyDescriptor(kind.holder, key)!.value === "function")
      .map(key => (typeof key === "string" ? key : wellKnownSymbols.get(key)!));
    const calls: string[] = [];
    for (const method of methods) {
      const values = [...odd, ...kind.meddlers].filter(each => !makesThatMany.test(method) || !isLarge(each));
      const lists = [
        "",
        ...values,
        ...values.map(each => kind.first + ", " + each),
        ...kind.meddlers.map(each => kind.first + ", " + kind.first + ", " + each),
      ];
      for (const receiver of kind.receivers)
        for (const passed of lists) calls.push(writeCall(receiver, kind.call(method, passed), calls.length));
    }
    const inOneProgram = 2500;
    for (let first = 0, part = 1; first < calls.length; first += inOneProgram, part++)
      programs.push({
        name: kind.name + (calls.length > inOneProgram ? ", part " + part : ""),
        calls: Math.min(inOneProgram, calls.length - first),
        program: [prelude, ...calls.slice(first, first + inOneProgram), "process.exit(0);"].join("\n"),
      });
  }
  console.log(JSON.stringify(programs));
  process.exit(0);
}

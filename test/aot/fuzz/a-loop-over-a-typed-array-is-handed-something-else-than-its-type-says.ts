// A table, no seeds: a function of a TypeScript file goes over a parameter that is declared as a typed array, and a JavaScript file hands it something else.
//
//   what the parameter is declared as x what arrives x who says that it is what is declared x what a turn does x how the loop counts, each at every length from 0 to 17 and from 31 to 33
//
// Every case is a function of the file, called by the file's own code. What throws is caught, and the name of its class is printed.
type Named = { name: string; text: string };

const declared = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
];

/** The names that `prepare` of the JavaScript file knows. */
const arrivals = [
  "as declared",
  "Int8Array",
  "Uint8Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "a list",
  "a list with holes",
  "a list of texts",
  "a list with fractions",
  "a list that may not change",
  "an object with a length",
  "the arguments of a call",
  "a text",
  "a class below with a shorter length",
  "a class below with a longer length",
  "a proxy",
  "over a buffer that has shrunk",
  "over a buffer that has grown",
  "over a buffer that was handed away",
  "over a shared buffer",
  "from the second element of a buffer",
  "nothing",
];

/** `M` is the call that makes it, less the name of the function; `T` is the declared type. */
const sayers: readonly Named[] = [
  { name: "a declaration file", text: "const v = declaredM;" },
  { name: "a cast", text: "const v = unknownM as T;" },
  { name: "any", text: "const v: T = looseM;" },
];

/** `E` is the element, `k` counts, `w` is what is declared, of the same length. */
const turns: readonly Named[] = [
  { name: "added up", text: "sum += E;" },
  { name: "added up and cut to an int32", text: "sum = (sum + E) | 0;" },
  { name: "the greatest", text: "sum = Math.max(sum, E);" },
  { name: "one more", text: "v[k] = E + 1;" },
  { name: "three times the index", text: "v[k] = k * 3;" },
  { name: "copied out", text: "w[k] = E;" },
  { name: "copied in", text: "v[k] = w[k]!;" },
  { name: "both added", text: "v[k] = E + w[k]!;" },
];

/** `K` is the turn. */
const counted: readonly (Named & { isOverValues?: true })[] = [
  { name: "up to the length", text: "for (let k = 0; k < v.length; k++) { K }" },
  { name: "down from the length", text: "for (let k = v.length - 1; k >= 0; k--) { K }" },
  { name: "over its values", text: "let k = -1; for (const x of v) { k++; K }", isOverValues: true },
];

const crossed = declared.flatMap(type =>
  arrivals
    .filter(arrival => arrival !== type)
    .flatMap(arrival =>
      sayers.flatMap(sayer => turns.flatMap(turn => counted.map(counts => ({ type, arrival, sayer, turn, counts })))),
    ),
);

export const inOne = 12;
const laidOut = [[], ["--aot-heat=everything-is-hot"], ["--aot-erase-types"]];
const inOneBuild = Math.ceil(crossed.length / inOne);
export const programs = laidOut.length * inOneBuild;
export const cases = crossed.length;

/** The flags that the program of that number is built with. */
export const flagsOf = (index: number): string[] => laidOut[Math.floor(index / inOneBuild)];

const makers = `const value = at => Math.imul(at + 1, 121510) >> [0, 16, 24, 23, 15][at % 5];
function fill(target, n) {
  for (let at = 0; at < n; at++) target[at] = value(at);
  return target;
}
export const reads = { count: 0 };
export function prepare(Kind, arrival, n) {
  const size = Kind.BYTES_PER_ELEMENT;
  switch (arrival) {
    case "as declared": return fill(new Kind(n), n);
    case "Int8Array": return fill(new Int8Array(n), n);
    case "Uint8Array": return fill(new Uint8Array(n), n);
    case "Uint16Array": return fill(new Uint16Array(n), n);
    case "Int32Array": return fill(new Int32Array(n), n);
    case "Uint32Array": return fill(new Uint32Array(n), n);
    case "Float32Array": return fill(new Float32Array(n), n).map(x => x + 0.5);
    case "Float64Array": return fill(new Float64Array(n), n).map(x => x + 0.1);
    case "BigInt64Array": return new BigInt64Array(n).map((_, at) => BigInt(value(at)));
    case "a list": return fill([], n);
    case "a list with holes": return fill([], n).reduce((list, x, at) => { if (at % 3 !== 2) list[at] = x; return list; }, new Array(n));
    case "a list of texts": return fill([], n).map(String);
    case "a list with fractions": return fill([], n).map(x => x + 0.5);
    case "a list that may not change": return Object.freeze(fill([], n));
    case "an object with a length": return fill({ length: n }, n);
    case "the arguments of a call": return (function () { return arguments; })(...fill([], n));
    case "a text": return "0123456789".repeat(4).slice(0, n);
    case "a class below with a shorter length": return fill(new (class extends Kind { get length() { return Math.max(0, super.length - 2); } })(n), n);
    case "a class below with a longer length": return fill(new (class extends Kind { get length() { return super.length + 2; } })(n), n);
    case "a proxy":
      return new Proxy(fill(new Kind(n), n), {
        get(target, key) { reads.count++; const got = Reflect.get(target, key, target); return typeof got === "function" ? got.bind(target) : got; },
        set(target, key, stored) { return Reflect.set(target, key, stored, target); },
      });
    case "over a buffer that has shrunk": { const buffer = new ArrayBuffer(n * size, { maxByteLength: n * size + 64 }); const view = fill(new Kind(buffer), n); buffer.resize((n >> 1) * size); return view; }
    case "over a buffer that has grown": { const buffer = new ArrayBuffer(n * size, { maxByteLength: n * size + 64 }); const view = fill(new Kind(buffer), n); buffer.resize(n * size + 3 * size); return view; }
    case "over a buffer that was handed away": { const view = fill(new Kind(n), n); view.buffer.transfer(); return view; }
    case "over a shared buffer": return fill(new Kind(new SharedArrayBuffer(n * size)), n);
    case "from the second element of a buffer": return fill(new Kind(n + 1), n + 1).subarray(1);
    case "nothing": return undefined;
  }
  throw new Error("no such arrival: " + arrival);
}
export { prepare as declared, prepare as unknown, prepare as loose };
`;

const declarations = `export declare const reads: { count: number };
export declare function prepare<T>(Kind: new (n: number) => T, arrival: "as declared", n: number): T;
export declare function declared<T>(Kind: new (n: number) => T, arrival: string, n: number): T;
export declare function unknown(Kind: unknown, arrival: string, n: number): unknown;
export declare function loose(Kind: unknown, arrival: string, n: number): any;
`;

export function programOf(index: number): { file: string; text: string; files: Record<string, string> } {
  const first = (index % inOneBuild) * inOne;
  // Neighbors in the table differ in how the loop counts alone: a stride that shares no factor with the length of the table takes a program from all over it.
  const stride = 7919;
  const functions = Array.from({ length: Math.min(crossed.length, first + inOne) - first }, (_, at) => {
    const { type, arrival, sayer, turn, counts } = crossed[((first + at) * stride) % crossed.length];
    const loop = counts.text.replaceAll("K", turn.text.replaceAll("E", counts.isOverValues ? "x" : "v[k]!"));
    const says = sayer.text.replaceAll("M", `(${type}, ${JSON.stringify(arrival)}, n)`).replaceAll("T", type);
    const label = `${type} | ${arrival} | ${sayer.name} | ${turn.name} | ${counts.name}`;
    return `function f${at}(v: ${type}, w: ${type}, start: number): string {
  let sum = start;
  ${loop}
  return show(sum);
}
for (const n of lengths) {
  let said: string;
  try {
    ${says}
    const w = prepare(${type}, "as declared", n);
    said = f${at}(v, w, 0);
    said += " | " + told(v) + " | " + told(w);
  } catch (error) {
    said = (error as Error).constructor.name;
  }
  console.log(${JSON.stringify(label)} + " | " + n + ": " + said + " " + reads.count);
}`;
  });
  return {
    file: "main.ts",
    text: `import { declared, loose, prepare, reads, unknown } from "./makers.js";
const lengths = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 31, 32, 33];
function show(value: unknown): string { return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value)); }
function told(held: unknown): string { return Array.prototype.map.call(held, String).join(); }
${functions.join("\n")}
`,
    files: { "makers.js": makers, "makers.d.ts": declarations },
  };
}

// An element of a typed array is read and stored at the width of the kind of the array: one byte of a Uint8Array, eight of a Float64Array. The kind is that of the object. The class that the text names may be another:
// a class of the program below a typed array, a class below that one, Buffer, a class whose parent was exchanged, a class that was constructed for another, a class whose species answers another kind.
//
// A program is one kind, another kind, a way to make the object and a way to declare it:
//   kind      what stands behind `extends`
//   other     the kind that comes in where the way to make the object lets another one in
//   made      how the object comes to be
//   declared  what the functions that use it say about their parameter
// In it every use stands in a function of its own, once for the object and once for each object that is derived from it, and each function is only ever given what one expression makes. What is printed is compared with plain Bun.
import { join } from "path";
import { spread } from "./case-files";

type Kind = { name: string; list: string; zero: string; one: string; type: string };

const numbers = (name: string, list: string): Kind => ({ name, list, zero: "0", one: "1", type: name });
const bigInts = (name: string): Kind => ({
  name,
  list: "[1n, 2n, 3n, 250n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n]",
  zero: "0n",
  one: "1n",
  type: name,
});
const integers = "[1, 2, 3, 250, -5, 300, 70000, 8, 9, 10, 11, 12]";
const fractions = "[1.5, 2.25, -3, 250, 5, 6.5, 7, 8, 9, -10, 11, 12.75]";

export const kinds: Record<string, Kind> = Object.fromEntries(
  [
    numbers("Int8Array", integers),
    numbers("Uint8Array", integers),
    numbers("Uint8ClampedArray", integers),
    numbers("Int16Array", integers),
    numbers("Uint16Array", integers),
    numbers("Int32Array", integers),
    numbers("Uint32Array", integers),
    numbers("Float16Array", fractions),
    numbers("Float32Array", fractions),
    numbers("Float64Array", fractions),
    bigInts("BigInt64Array"),
    bigInts("BigUint64Array"),
    numbers("Buffer", integers),
  ].map(kind => [kind.name, kind]),
);

// Two for each kind: one of another width, one of another sort of element.
const others: Record<string, string[]> = {
  Int8Array: ["Float64Array", "Uint16Array"],
  Uint8Array: ["Uint32Array", "Float32Array"],
  Uint8ClampedArray: ["Int16Array", "BigInt64Array"],
  Int16Array: ["Uint8Array", "Float64Array"],
  Uint16Array: ["Float32Array", "Buffer"],
  Int32Array: ["Float16Array", "Uint8Array"],
  Uint32Array: ["BigInt64Array", "Int8Array"],
  Float16Array: ["Int32Array", "Float64Array"],
  Float32Array: ["Uint8ClampedArray", "Float64Array"],
  Float64Array: ["Int8Array", "Float32Array"],
  BigInt64Array: ["Uint16Array", "Float64Array"],
  BigUint64Array: ["Float64Array", "Uint8Array"],
  Buffer: ["Uint16Array", "Float64Array"],
};

type Made = {
  /** Statements ahead of everything, over $K and $O, the two classes. */
  before: string;
  /** An expression. `$LIST` is a list for the kind, `$OTHERS` a list for the other kind. */
  make: string;
  /** The class that the text names for what `make` makes. */
  named: string;
  /** The elements are of the other kind. */
  holdsOther?: true;
};

// prettier-ignore
export const ways: Record<string, Made> = {
  "itself": { before: ``, make: `new $K($LIST)`, named: "K" },
  "one-below": { before: `class A extends $K {}`, make: `new A($LIST)`, named: "A" },
  "two-below": { before: `class Middle extends $K {}\nclass A extends Middle {}`, make: `new A($LIST)`, named: "A" },
  "three-below": { before: `class Upper extends $K {}\nclass Middle extends Upper {}\nclass A extends Middle {}`, make: `new A($LIST)`, named: "A" },
  "below-with-fields": { before: `class A extends $K { tag = 7; note = "n"; more() { return this.tag + this.length; } }`, make: `new A($LIST)`, named: "A" },
  "below-with-a-constructor": { before: `class A extends $K { tag: number; constructor(list: any) { super(list); this.tag = this.length; } }`, make: `new A($LIST)`, named: "A" },
  "of-a-length": { before: `class A extends $K {}`, make: `filled(new A(12))`, named: "A" },
  "over-memory": { before: `class A extends $K {}`, make: `new A(new $K($LIST).buffer)`, named: "A" },
  "over-a-part-of-memory": { before: `class A extends $K {}`, make: `new A(new $K($LIST).buffer, 16, 2)`, named: "A" },
  "parent-exchanged": { before: `class A extends $K {}\nObject.setPrototypeOf(A, $O);`, make: `new A($OTHERS)`, named: "A", holdsOther: true },
  "parent-and-prototype-exchanged": { before: `class A extends $K {}\nObject.setPrototypeOf(A, $O);\nObject.setPrototypeOf(A.prototype, $O.prototype);`, make: `new A($OTHERS)`, named: "A", holdsOther: true },
  "grandparent-exchanged": { before: `class Middle extends $K {}\nclass A extends Middle {}\nObject.setPrototypeOf(Middle, $O);`, make: `new A($OTHERS)`, named: "A", holdsOther: true },
  "parent-exchanged-late": { before: `class A extends $K {}\nconst EARLY = new A($LIST);\nObject.setPrototypeOf(A, $O);`, make: `new A($OTHERS)`, named: "A", holdsOther: true },
  "parent-exchanged-and-back": { before: `class A extends $K {}\nObject.setPrototypeOf(A, $O);\nconst EARLY = new A($OTHERS);\nObject.setPrototypeOf(A, $K);`, make: `new A($LIST)`, named: "A" },
  "prototype-of-the-object-exchanged": { before: ``, make: `Object.setPrototypeOf(new $K($LIST), $O.prototype)`, named: "O" },
  "prototype-of-the-object-is-a-class-below-the-other": { before: `class A extends $O {}`, make: `Object.setPrototypeOf(new $K($LIST), A.prototype)`, named: "A" },
  "constructed-for-a-class-below-the-kind": { before: `class A extends $K {}`, make: `Reflect.construct($O, [$OTHERS], A)`, named: "A", holdsOther: true },
  "constructed-for-the-other": { before: `class A extends $K {}`, make: `Reflect.construct(A, [$LIST], $O)`, named: "O" },
  "constructed-for-the-kind": { before: ``, make: `Reflect.construct($O, [$OTHERS], $K)`, named: "K", holdsOther: true },
  "constructor-returns-the-other": { before: `class A extends $K { constructor(list: any) { super(list); return new $O($OTHERS) as any; } }`, make: `new A($LIST)`, named: "A", holdsOther: true },
  "constructor-returns-a-class-below-the-other": { before: `class Below extends $O {}\nclass A extends $K { constructor(list: any) { super(list); return new Below($OTHERS) as any; } }`, make: `new A($LIST)`, named: "A", holdsOther: true },
  "species-is-the-other": { before: `class A extends $K { static get [Symbol.species]() { return $O; } }`, make: `new A($LIST)`, named: "A" },
  "species-is-a-class-below-the-other": { before: `class Below extends $O {}\nclass A extends $K { static get [Symbol.species]() { return Below; } }`, make: `new A($LIST)`, named: "A" },
  "species-is-the-kind": { before: `class A extends $K { static get [Symbol.species]() { return $K; } }`, make: `new A($LIST)`, named: "A" },
  "species-is-nothing": { before: `class A extends $K { static get [Symbol.species]() { return undefined; } }`, make: `new A($LIST)`, named: "A" },
  "constructor-of-the-object-is-the-other": { before: `class A extends $K {}`, make: `Object.defineProperty(new A($LIST), "constructor", { value: $O })`, named: "A" },
  "one-class-text-below-both": { before: `const below = (Base: any) => class extends Base {};\nconst A = below($K);\nconst B = below($O);\nconst SECOND = new B($OTHERS);`, make: `new A($LIST)`, named: "K" },
  "one-class-text-below-both-the-second": { before: `const below = (Base: any) => class extends Base {};\nconst B = below($K);\nconst A = below($O);\nconst FIRST = new B($LIST);`, make: `new A($OTHERS)`, named: "K", holdsOther: true },
  "parent-chosen-when-it-runs": { before: `const A = class extends (process.argv.length > 90 ? $K : $O) {};`, make: `new A($OTHERS)`, named: "K", holdsOther: true },
  "below-a-function": { before: `function A(this: any, list: any) { return Reflect.construct($K, [list], new.target ?? A); }\nObject.setPrototypeOf(A, $K);\nObject.setPrototypeOf(A.prototype, $K.prototype);`, make: `new (A as any)($LIST)`, named: "K" },
  "below-nothing": { before: ``, make: `Object.setPrototypeOf(new $K($LIST), null)`, named: "K" },
  "below-the-prototype-of-objects": { before: ``, make: `Object.setPrototypeOf(new $K($LIST), Object.prototype)`, named: "K" },
  "below-the-prototype-of-arrays": { before: ``, make: `Object.setPrototypeOf(new $K($LIST), Array.prototype)`, named: "K" },
  "below-an-object-with-elements": { before: `const ABOVE = { 0: "zero", 1: "one", 50: "fifty", length: 3 };`, make: `Object.setPrototypeOf(new $K($LIST), ABOVE)`, named: "K" },
  "an-object-below-it": { before: ``, make: `Object.create(new $K($LIST))`, named: "K" },
  "an-array-below-it": { before: ``, make: `Object.setPrototypeOf([$ONE, , $ONE], new $K($LIST))`, named: "K" },
  "from": { before: `class A extends $K {}`, make: `A.from($LIST)`, named: "A" },
  "of": { before: `class A extends $K {}`, make: `A.of(...$LIST)`, named: "A" },
  "from-called-on-the-other": { before: `class A extends $K {}`, make: `A.from.call($O, $OTHERS)`, named: "A", holdsOther: true },
};

// Over `v`, what was made.
// prettier-ignore
export const derivations: Record<string, string> = {
  "itself": `v`,
  "subarray": `v.subarray(1)`,
  "subarray-of-subarray": `v.subarray(1).subarray(1, 9)`,
  "slice": `v.slice(1)`,
  "map": `v.map((x: any) => x)`,
  "filter": `v.filter((x: any, i: number) => i !== 2)`,
  "toSorted": `v.toSorted()`,
  "toReversed": `v.toReversed()`,
  "with": `v.with(0, v[1])`,
  "by-its-constructor": `new v.constructor(v)`,
  "fill": `v.fill(v[3], 1, 3)`,
  "reverse": `v.reverse()`,
};

// Over `b`. $ZERO and $ONE are elements of what the text names.
// prettier-ignore
export const uses: Record<string, string> = {
  "values-of": `const out = []; for (const x of b) out.push(x); return out;`,
  "sum-of": `let s = $ZERO; for (const x of b) s += x; return s;`,
  "sum-by-index": `let s = $ZERO; for (let i = 0; i < b.length; i++) s += b[i]; return s;`,
  "sum-with-kept-length": `let s = $ZERO; const n = b.length; for (let i = 0; i < n; i++) s += b[i]; return s;`,
  "sum-backwards": `let s = $ZERO; for (let i = b.length - 1; i >= 0; i--) s += b[i]; return s;`,
  "list-by-index": `const out = []; for (let i = 0; i < b.length; i++) out.push(b[i]); return out;`,
  "ends": `return [b[0], b[1], b[b.length - 1], b[b.length], b[-1], b[100]];`,
  "entries": `const out = []; for (const [i, x] of b.entries()) out.push(i, x); return out;`,
  "keys": `const out = []; for (const i of b.keys()) out.push(i, b[i]); return out;`,
  "values": `const out = []; for (const x of b.values()) out.push(x); return out;`,
  "spread": `return [...b];`,
  "spread-into-a-call": `return count(...b);`,
  "destructure": `const [first, second, , fourth, ...rest] = b; return [first, second, fourth, rest];`,
  "Array.from": `return Array.from(b);`,
  "Array.from-mapped": `return Array.from(b, (x: any) => [x]);`,
  "indexOf": `return [b.indexOf(b[3]), b.indexOf(b[0], 1), b.lastIndexOf(b[2]), b.includes(b[4]), b.includes(undefined)];`,
  "set-a-list": `b.set([$ONE, $ONE], 1); return list(b);`,
  "set-itself": `b.set(b.subarray(2, 4), 0); return list(b);`,
  "copyWithin": `return list(b.copyWithin(0, 2, 5));`,
  "store-by-index": `for (let i = 0; i < b.length; i++) b[i] = $ONE; return list(b);`,
  "add-in-place": `for (let i = 0; i < b.length; i++) b[i] += $ONE; return list(b);`,
  "copy-down": `for (let i = 0; i + 1 < b.length; i++) b[i] = b[i + 1]; return list(b);`,
  "store-at-the-ends": `b[0] = $ONE; b[b.length - 1] = $ONE; b[b.length] = $ONE; b[-1] = $ONE; return [list(b), b.length];`,
  "bytes-beside-it": `const d = new DataView(b.buffer, b.byteOffset, b.byteLength); const out = []; for (let i = 0; i < d.byteLength; i++) out.push(d.getUint8(i)); return [out, b[0], b[1]];`,
  "bytes-written-beside-it": `const d = new DataView(b.buffer, b.byteOffset, b.byteLength); const first = b[0]; d.setUint8(0, 65); d.setUint8(d.byteLength - 1, 66); return [first, b[0], b[b.length - 1]];`,
  "stored-then-bytes": `b[1] = $ONE; const d = new DataView(b.buffer, b.byteOffset, b.byteLength); const out = []; for (let i = 0; i < d.byteLength && i < 24; i++) out.push(d.getUint8(i)); return out;`,
  "sizes": `return [b.length, b.byteLength, b.byteOffset, b.BYTES_PER_ELEMENT, b.buffer.byteLength];`,
  "at": `return [b.at(0), b.at(-1), b.at(3), b.at(100)];`,
  "join": `return b.join("-");`,
  "reduce": `return b.reduce((a: any, x: any) => a + x);`,
  "forEach": `const out: any[] = []; b.forEach((x: any, i: number) => { out.push(i, x); }); return out;`,
  "find": `return [b.find((x: any) => x > $ONE), b.findIndex((x: any) => x > $ONE), b.findLast((x: any) => x > $ONE), b.every((x: any) => x > $ZERO), b.some((x: any) => x < $ZERO)];`,
  "sort": `return list(b.sort());`,
  "names": `return [nameOf(b), Object.prototype.toString.call(b), b[Symbol.toStringTag], b instanceof $K, b instanceof $O];`,
  "if-an-instance": `if (b instanceof $K) { let s = $ZERO; for (let i = 0; i < b.length; i++) s += b[i]; return ["the kind", s]; } return ["not the kind", b[0]];`,
  "if-an-instance-of-the-named": `if (b instanceof $NAMED) { const out = []; for (const x of b) out.push(x); return ["the named", out, b[1]]; } return ["not the named", b[1]];`,
  "in-an-object": `const holder = { view: b, at: 3 }; see(holder); return [holder.view[holder.at], holder.view.length];`,
  "from-a-closure": `const read = (i: number) => b[i]; see(read); return [read(0), read(3), read(50)];`,
  "two-at-once": `const c = b.subarray(2); let s = $ZERO; for (let i = 0; i < c.length; i++) s += b[i] + c[i]; return s;`,
  "own-keys": `return [Object.keys(b), 3 in b, 50 in b, Object.hasOwn(b, 3)];`,
  "atomics": `return [Atomics.load(b, 1), Atomics.add(b, 1, $ONE), Atomics.exchange(b, 2, $ONE), Atomics.compareExchange(b, 3, b[3], $ONE), Atomics.store(b, 4, $ONE), list(b)];`,
  "a-part-as-text": `return [new TextDecoder("latin1").decode(b.subarray(1, 3)), new TextDecoder("latin1").decode(b)];`,
  "parts-compared": `return [Buffer.compare(b.subarray(1, 4), b.subarray(2, 5)), Buffer.byteLength(b.subarray(1)), Buffer.byteLength(b)];`,
  "parts-joined": `return list(Buffer.concat([b.subarray(1, 3), b.subarray(4)]));`,
  "a-part-hashed": `return [Bun.hash.crc32(b.subarray(1, 3)), Bun.hash.crc32(b)];`,
  "a-part-copied": `return [list(new Uint8Array(b.subarray(1, 3))), list(Buffer.from(b.subarray(1, 3))), list(new Float64Array(b.length ? 2 : 0).fill(1))];`,
  "made-and-read": `const c = new $NAMED(4); c[1] = $ONE; return [c[0], c[1], c.length, c.byteLength];`,
};

// What a function says about its parameter. $NAMED is the class that the text names, $K the kind, $O the other kind.
export const declarations: Record<string, string> = {
  "as-named": "$NAMED_TYPE",
  "as-the-kind": "$K",
  "as-the-other": "$O",
  "as-either": "$K | $O",
  "as-anything": "any",
  "as-indexed": "ArrayLike<any>",
};

export const everyCase = Object.keys(kinds).flatMap(kind =>
  others[kind].flatMap(other =>
    Object.keys(ways).flatMap(made =>
      Object.keys(declarations).map(declared => `${kind} ${other} ${made} ${declared}`),
    ),
  ),
);
export const sample = (count: number) => spread(everyCase, count);

const options = () =>
  JSON.stringify({
    compilerOptions: {
      target: "esnext",
      module: "preserve",
      moduleResolution: "bundler",
      strict: false,
      noEmit: true,
      skipLibCheck: true,
      typeRoots: [join(import.meta.dir, "..", "..", "..", "..", "packages")],
      types: ["bun-types"],
    },
  });

export function program(name: string, turns = 3): { file: string; text: string; files: Record<string, string> } {
  const [kindName, otherName, madeName, declaredName] = name.split(" ");
  const kind = kinds[kindName];
  const other = kinds[otherName];
  const made = ways[madeName];
  // A constant that holds a class expression names no type.
  const named = made.named === "A" ? "A" : made.named === "K" ? kind.name : other.name;
  const namedType = made.named === "A" && !/^class A\b/m.test(made.before) ? kind.name : named;
  const held = made.holdsOther ? other : kind;
  const words: [string, string][] = [
    ["$NAMED_TYPE", namedType],
    ["$NAMED", named],
    ["$OTHERS", other.list],
    ["$LIST", kind.list],
    ["$ZERO", held.zero],
    ["$ONE", held.one],
    ["$K", kind.name],
    ["$O", other.name],
  ];
  const fill = (text: string) => words.reduce((filled, [word, meaning]) => filled.replaceAll(word, meaning), text);
  const isTyped = declaredName !== "as-anything";

  let text = `let SEEN = 0;
function see(value: unknown): void { if (value !== null && value !== undefined) SEEN++; }
function count(...all: unknown[]): unknown { return [all.length, all[0], all[all.length - 1]]; }
function nameOf(value: any): string { return value?.constructor?.name ?? "none"; }
function list(value: any): string { try { return Array.prototype.join.call(value, ","); } catch (error) { return "no list"; } }
function filled(view: any): any { const from: any[] = ${held.list}; for (let i = 0; i < view.length; i++) view[i] = from[i]; return view; }
function show(value: unknown): string {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) { let out = "["; for (let i = 0; i < value.length; i++) out += (i ? "," : "") + (i in value ? show(value[i]) : "_"); return out + "]"; }
  return nameOf(value) + "(" + list(value) + ")";
}
function told(name: string, run: () => unknown): void {
  let answer = "";
  for (let turn = 0; turn < ${turns}; turn++) {
    let now: string;
    try { now = show(run()); } catch (error: any) { now = "threw " + error?.name; }
    if (turn && now !== answer) console.log(name, "| turn", turn, "|", now);
    answer = now;
  }
  console.log(name, "|", answer);
}
${fill(made.before)
  .split("\n")
  .filter(line => line)
  .map(line => `// @ts-ignore\n${line}\n`)
  .join("")}`;
  Object.entries(derivations).forEach(([derivation, derived], n) => {
    text += `// @ts-ignore\nfunction made${n}() { const v${isTyped ? "" : ": any"} = ${fill(made.make)}; return ${derived}; }\n`;
    Object.entries(uses).forEach(([use, body], u) => {
      text += `// @ts-ignore\nfunction use${n}_${u}(b: ${fill(declarations[declaredName])}): unknown { ${fill(body)} }\n`;
      text += `told(${JSON.stringify(`${derivation} ${use}`)}, () => use${n}_${u}(made${n}() as any));\n`;
    });
  });
  return { file: "program.ts", text, files: { "tsconfig.json": options() } };
}

// An object or an array can be born in a cell of its own, in the cell of the object that will hold it, in the frame, or not at all; and there are many ways of making one: a literal, a copy by spread, a class,
// a function that answers a fresh one, a table of empty objects, an operation of the run time. Whoever makes the cell has to make it where the rest of the code expects it: a holder that takes the memory around
// an object that was born alone writes into its neighbor.
//
// Every case is a maker and a place, with names, layouts and classes of its own, so that what the compiler decides for one case says nothing about the next:
//   maker  how the object or the array is made
//   place  what becomes of it: answered, listed by a literal, a class, an array, two or three levels deep, by the caller; seen, stored, read, changed or collected in between; held sometimes; never leaving ..
// Each case runs a few hundred times between neighbors that are kept. What every kept value looks like is written down when it is made and compared later, across collections. What is printed is compared with plain Bun.
import { spread } from "./case-files";

type Names = { n: number; a: string; b: string; s: string; R: string; src: string; other: string; nums: string; wide: string };

// prettier-ignore
const objectMakers: Record<string, (x: Names) => string> = {
  "literal": x => `{ ${x.a}: k, ${x.b}: k + 1, ${x.s}: "t" }`,
  "literal-of-doubles": x => `{ ${x.a}: k + 0.5, ${x.b}: k / 4, ${x.s}: TEXTS[k & 3] }`,
  "spread": x => `{ ...${x.src} }`,
  "spread-then-field": x => `{ ...${x.src}, ${x.a}: k }`,
  "spread-then-two-fields": x => `{ ...${x.src}, ${x.a}: ${x.src}.${x.a} + 1, ${x.s}: TEXTS[k & 3] }`,
  "field-then-spread": x => `{ ${x.a}: k, ...(${x.src} as Partial<${x.R}>) } as ${x.R}`,
  "two-spreads": x => `{ ...${x.src}, ...${x.other} }`,
  "spread-of-either": x => `{ ...(k & 1 ? ${x.src} : ${x.other}), ${x.b}: k }`,
  "class": x => `new Made${x.n}(k, k + 1, "c")`,
  "class-with-initializers": x => `new Initialized${x.n}()`,
  "function": x => `make${x.n}(k)`,
  "function-that-copies": x => `copy${x.n}(${x.src}, k)`,
  "filled-later": x => `fill${x.n}(k)`,
  "assign": x => `Object.assign({}, ${x.src}) as ${x.R}`,
  "assign-onto-literal": x => `Object.assign({ ${x.a}: 0, ${x.b}: 0, ${x.s}: "" }, ${x.src})`,
  "clone": x => `structuredClone(${x.src})`,
  "parsed": x => `JSON.parse(text${x.n}) as ${x.R}`,
  "either-literal": x => `k & 1 ? { ${x.a}: k, ${x.b}: 1, ${x.s}: "x" } : { ${x.a}: k, ${x.b}: 2, ${x.s}: "y" }`,
  "copy-or-literal": x => `k & 1 ? { ...${x.src}, ${x.a}: k } : { ${x.a}: k, ${x.b}: 2, ${x.s}: "y" }`,
  "copy-or-given": x => `k & 1 ? { ...${x.src}, ${x.a}: k } : ${x.src}`,
  "rest": x => `rest${x.n}(${x.wide})`,
  "by-switch": x => `choose${x.n}(k)`,
  "frozen": x => `Object.freeze({ ${x.a}: k, ${x.b}: 1, ${x.s}: "z" })`,
  "copy-of-copy": x => `{ ...{ ...${x.src}, ${x.a}: k }, ${x.b}: k }`,
  "copy-of-one-that-is-held": x => `{ ...held${x.n}.kept${x.n}, ${x.a}: k }`,
  "copy-of-one-just-held": x => `{ ...hold${x.n}(k).kept${x.n} }`,
  "one-that-is-held": x => `hold${x.n}(k).kept${x.n}`,
};

// prettier-ignore
const arrayMakers: Record<string, (x: Names) => string> = {
  "array": () => `[k, k + 1]`, "array-of-doubles": () => `[k + 0.5, 1.5, k / 4]`, "array-of-one": () => `[k]`, "empty-array": () => `[]`, "array-of-seven": () => `[k, 1, 2, 3, 4, 5, 6]`, "array-of-eight": () => `[k, 1, 2, 3, 4, 5, 6, 7]`,
  "array-spread": x => `[...${x.nums}]`, "array-spread-more": x => `[k, ...${x.nums}]`, "array-slice": x => `${x.nums}.slice()`, "array-map": x => `${x.nums}.map(v => v + k)`, "array-from": x => `Array.from(${x.nums})`,
  "array-of": () => `Array.of(k, 1)`, "array-filled": () => `new Array<number>(2).fill(k)`, "either-array": () => `k & 1 ? [k] : [k, 1]`, "array-or-given": x => `k & 1 ? [k, 2] : ${x.nums}`, "array-by-function": x => `list${x.n}(k)`,
  "array-pushed": () => `pushed(k)`, "array-concat": x => `${x.nums}.concat(k)`,
};

type Place = (made: string, x: Names, read: (v: string) => string, write: (v: string, w: string) => string, T: string) => string;
// prettier-ignore
const places: Record<string, Place> = {
  "answered": made => `return ${made};`,
  "in-a-literal": (made, x) => `return { inner${x.n}: ${made}, z${x.n}: k };`,
  "in-the-middle-of-a-literal": (made, x) => `return { y${x.n}: k + 0.5, inner${x.n}: ${made}, z${x.n}: TEXTS[k & 3], w${x.n}: k };`,
  "in-a-class": (made, x) => `return new Holder${x.n}(${made}, k);`,
  "twice-in-a-literal": (made, x) => `return { p${x.n}: ${made}, q${x.n}: ${made}, z${x.n}: k };`,
  "three-levels": (made, x) => `return { top${x.n}: { inner${x.n}: ${made}, z${x.n}: k }, w${x.n}: k + 1 };`,
  "in-an-array": made => `return [${made}, ${made}];`,
  "in-an-array-in-a-literal": (made, x) => `return { list${x.n}: [${made}], z${x.n}: k };`,
  "held-by-the-caller": (_, x) => `return { inner${x.n}: alone${x.n}(k), z${x.n}: k };`,
  "held-by-the-caller-of-the-caller": (_, x) => `return { inner${x.n}: through${x.n}(k), z${x.n}: k };`,
  "held-sometimes": (made, x) => `const made = ${made}; return k % 3 ? { inner${x.n}: made, z${x.n}: k } : made;`,
  "held-seldom": (made, x) => `const made = ${made}; return k % 16 ? made : { inner${x.n}: made, z${x.n}: k };`,
  "held-by-either": (made, x) => `const made = ${made}; return k & 2 ? { inner${x.n}: made, z${x.n}: k } : { inner${x.n}: made, z${x.n}: -k };`,
  "seen-first": (made, x) => `const made = ${made}; see(made); return { inner${x.n}: made, z${x.n}: k };`,
  "stored-first": (made, x) => `const made = ${made}; STORED = made; return { inner${x.n}: made, z${x.n}: k };`,
  "read-first": (made, x, read) => `const made = ${made}; const was = ${read("made")}; return { inner${x.n}: made, z${x.n}: was };`,
  "changed-first": (made, x, _, write) => `const made = ${made}; ${write("made", "k + 7")}; return { inner${x.n}: made, z${x.n}: k };`,
  "changed-afterwards": (made, x, _, write) => `const holder = { inner${x.n}: ${made}, z${x.n}: k }; ${write(`holder.inner${x.n}`, "k + 9")}; holder.z${x.n} = k + 1; return holder;`,
  "collected-between": (made, x) => `const made = ${made}; collect(k); return { inner${x.n}: made, z${x.n}: k };`,
  "others-made-between": (made, x) => `const made = ${made}; const near = { near${x.n}: k, far${x.n}: "n" }; const list = [k, k]; return { inner${x.n}: made, z${x.n}: k, near${x.n}: near, list${x.n}: list };`,
  "a-call-between": (made, x) => `const made = ${made}; const depth = deep(k & 3); return { inner${x.n}: made, z${x.n}: depth };`,
  "never-leaves": (made, _, read) => `const made = ${made}; return ${read("made")};`,
  "only-the-inner-one-leaves": (made, x) => `const holder = { inner${x.n}: ${made}, z${x.n}: k }; return holder.inner${x.n};`,
  "neither-leaves": (made, x, read) => `const holder = { inner${x.n}: ${made}, z${x.n}: k }; return holder.z${x.n} + Number(${read(`holder.inner${x.n}`)});`,
  "thrown": (made, x) => `try { throw { inner${x.n}: ${made}, z${x.n}: k }; } catch (caught) { return caught; }`,
  "captured": (made, x, read) => `const made = ${made}; return { inner${x.n}: made, read${x.n}: () => ${read("made")} };`,
  "in-a-loop": (made, x) => `let holder: unknown = null; for (let i = 0; i < 3; i++) holder = { inner${x.n}: ${made}, z${x.n}: i }; return holder;`,
  "every-turn-kept": (made, x) => `const all: unknown[] = []; for (let i = 0; i < 3; i++) all.push({ inner${x.n}: ${made}, z${x.n}: i }); return all;`,
  "pointed-elsewhere": (made, x, _r, _w, T) => `const holder: { inner${x.n}: ${T}; z${x.n}: number } = { inner${x.n}: ${made}, z${x.n}: k }; const first = holder.inner${x.n}; holder.inner${x.n} = ${made}; return [holder, first];`,
  "holder-copied": (made, x) => `const holder = { inner${x.n}: ${made}, z${x.n}: k }; return [{ ...holder, z${x.n}: k + 1 }, holder];`,
  "as-an-argument": (made, x) => `return kept({ inner${x.n}: ${made}, z${x.n}: k });`,
  "in-a-map": (made, x) => `return new Map<string, unknown>([["m", { inner${x.n}: ${made}, z${x.n}: k }]]);`,
  "awaited-between": (made, x) => `return (async () => { const made = ${made}; await null; return { inner${x.n}: made, z${x.n}: k }; })();`,
  "yielded": (made, x) => `return [...(function* () { yield { inner${x.n}: ${made}, z${x.n}: k }; yield { inner${x.n}: ${made}, z${x.n}: -k }; })()];`,
  "optional": (made, x, _r, _w, T) => `const holder: { inner${x.n}?: ${T}; z${x.n}: number } = k & 1 ? { inner${x.n}: ${made}, z${x.n}: k } : { z${x.n}: k }; return holder;`,
  "or-null": (made, x, _r, _w, T) => `const holder: { inner${x.n}: ${T} | null; z${x.n}: number } = { inner${x.n}: k & 1 ? ${made} : null, z${x.n}: k }; return holder;`,
};

const head = (isOpened: boolean) => `declare const console: { log(...values: unknown[]): void };
const seen = ${isOpened ? 'new Function("value", "return value" + String(process.argv.length).slice(9)) as <V>(value: V) => V' : "<V>(value: V): V => value"};
const TEXTS: string[] = seen(["one", "two", "three", "four"]);
let STORED: unknown = null;
let SEEN = 0;
function see(value: unknown): void { if (typeof value === "object" && value !== null) SEEN++; }
function kept<V>(value: V): V { STORED = value; return value; }
function collect(k: number): void { if (k % 97 === 0) Bun.gc(true); }
function deep(depth: number): number { return depth > 0 ? deep(depth - 1) + 1 : 0; }
function pushed(k: number): number[] { const list: number[] = []; list.push(k); list.push(k + 1); return list; }
function show(value: unknown): string {
  if (typeof value === "function") return "()=>" + show(value());
  if (typeof value !== "object" || value === null) return typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) { let text = "["; for (let i = 0; i < value.length; i++) text += (i ? "," : "") + (i in value ? show(value[i]) : "_"); return text + "]"; }
  if (value instanceof Map) return "Map" + show([...value]);
  let text = Object.isFrozen(value) ? "frozen{" : "{";
  for (const key of Object.keys(value)) text += key + ":" + show((value as Record<string, unknown>)[key]) + ";";
  return text + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : Object.getPrototypeOf(value)?.constructor?.name ?? "null");
}
function mix(hash: number, text: string): number { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; return hash; }
`;

function declarationsOf(x: Names, made: string, T: string): string {
  const { n, a, b, s, R } = x;
  return `type ${R} = { ${a}: number; ${b}: number; ${s}: string };
const ${x.src}: ${R} = seen({ ${a}: 1, ${b}: 2.5, ${s}: "src" }), ${x.other}: ${R} = seen({ ${a}: 3, ${b}: 4, ${s}: "other" }), ${x.wide} = seen({ extra${n}: 9, ${a}: 5, ${b}: 6, ${s}: "wide" }), ${x.nums}: number[] = seen([1, 2, 3]);
const text${n}: string = seen(JSON.stringify(${x.src}));
class Made${n} { ${a}: number; ${b}: number; ${s}: string; constructor(a: number, b: number, s: string) { this.${a} = a; this.${b} = b; this.${s} = s; } }
class Initialized${n} { ${a} = 1; ${b} = 2.5; ${s} = "i"; }
class Empty${n}A { ${a}!: number; ${b}!: number; ${s}!: string; } class Empty${n}B { ${b}!: number; ${a}!: number; ${s}!: string; } class Empty${n}C { ${s}!: string; ${a}!: number; ${b}!: number; }
class Holder${n} { inner${n}: ${T}; z${n}: number; constructor(inner: ${T}, z: number) { this.inner${n} = inner; this.z${n} = z; } }
function make${n}(k: number): ${R} { return { ${a}: k, ${b}: k + 2, ${s}: "f" }; }
function copy${n}(from: ${R}, k: number): ${R} { return { ...from, ${b}: k }; }
function fill${n}(k: number): ${R} { const made = {} as ${R}; made.${a} = k; made.${b} = 1; made.${s} = "l"; return made; }
function rest${n}({ extra${n}, ...rest }: ${R} & { extra${n}: number }): ${R} { return rest; }
function choose${n}(k: number): ${R} { let made: ${R}; switch (k & 3) { case 0: made = new Empty${n}A(); break; case 1: made = new Empty${n}B(); break; case 2: made = new Empty${n}C(); break; default: made = new Empty${n}A(); break; } made.${a} = k; made.${b} = 2; made.${s} = "w"; return made; }
function list${n}(k: number): number[] { return [k, k + 2, 5]; }
function hold${n}(k: number): { kept${n}: ${R}; rest${n}: number } { return { kept${n}: { ${a}: k, ${b}: 8, ${s}: "held" }, rest${n}: k }; }
const held${n} = seen(hold${n}(7));
function alone${n}(k: number): ${T} { return ${made}; }
function through${n}(k: number): ${T} { return alone${n}(k + 1); }
`;
}

export const ways: Record<string, string[]> = {
  "as built": [],
  "everything hot": ["--aot-heat=everything-is-hot"],
  "everything cold": ["--aot-heat=everything-is-cold"],
  "no inlining": ["--aot-disable=InlineCalls"],
  "hot, no inlining": ["--aot-heat=everything-is-hot", "--aot-disable=InlineCalls"],
  "validating": ["--aot-validate"],
  "types erased": ["--aot-erase-types"],
  "proofs checked": ["--aot-testing=CheckProofsAtRunTime"],
  "hot, proofs checked": ["--aot-heat=everything-is-hot", "--aot-testing=CheckProofsAtRunTime"],
};

export const everyCase = [...Object.keys(objectMakers), ...Object.keys(arrayMakers)].flatMap(maker => Object.keys(places).map(place => `${maker} ${place}`));
export const sample = (count: number) => spread(everyCase, count);

export function program(cases: string[], isOpened = false, turns = 300): { file: string; text: string } {
  let text = head(isOpened);
  cases.forEach((name, n) => {
    const [maker, place] = name.split(" ");
    const x: Names = { n, a: `a${n}`, b: `b${n}`, s: `s${n}`, R: `R${n}`, src: `src${n}`, other: `other${n}`, nums: `nums${n}`, wide: `wide${n}` };
    const isArray = maker in arrayMakers;
    const T = isArray ? "number[]" : x.R;
    const made = `((${(isArray ? arrayMakers : objectMakers)[maker](x)}) as ${T})`;
    const read = (v: string) => (isArray ? `${v}[0]` : `${v}.${x.a}`);
    const write = (v: string, w: string) => `${read(v)} = ${w}`;
    text += declarationsOf(x, made, T) + `function c${n}(k: number): unknown { ${places[place](made, x, read, write, T)} }\n`;
  });
  text += `const CASES: [string, (k: number) => unknown][] = [${cases.map((name, n) => `[${JSON.stringify(name)}, c${n}]`).join(", ")}];
for (const [name, run] of CASES) {
  const ring: unknown[] = [], looks: string[] = [];
  let hash = 0, changed = 0, threw = 0;
  for (let k = 1; k <= ${turns}; k++) {
    const before = { left: k, text: TEXTS[k & 3] };
    let result: unknown;
    try { result = await run(k); } catch (error) { result = "threw " + (error instanceof Error ? error.name : String(error)); threw++; }
    const after = [k, k + 0.5];
    const look = show([before, result, after]);
    hash = mix(hash, look);
    ring[k & 15] = [before, result, after];
    looks[k & 15] = look;
    if (k % 50 === 0) {
      if (k % 100 === 0) Bun.gc(true);
      for (let i = 0; i < ring.length; i++) if (ring[i] !== undefined && show(ring[i]) !== looks[i]) changed++;
    }
  }
  console.log(name, hash, changed, threw, looks[1]);
}
console.log(SEEN, show(STORED));
`;
  return { file: "main.ts", text };
}

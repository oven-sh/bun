// One function holds very many values at once: each is read in a block of its own and used far from where it was made. A program draws the
// kind of value (out of typed arrays, lists of numbers, lists of texts, fields of objects), the order in which the values are made and used
// (all made then used forward or backward, used a while later, carried round a loop, stored in a try and read in its handler) and how many
// there are, from two thousand to forty-six thousand. It prints one checksum a call. The programs are large and their builds take minutes.
import type { Random } from "./random";

const kinds: Record<string, any> = {
  "typed-arrays": {
    setup: (n: number) =>
      `const a = new Float64Array(${n}), b = new Int32Array(${n});\nfor (let i = 0; i < ${n}; i++) { a[i] = i + 0.5; b[i] = i * 3; }`,
    types: "a: Float64Array, b: Int32Array",
    load: (i: number) => (i % 2 ? "a" : "b") + "[" + i + "]",
    zero: "0",
    use: (v: string) => v + " * 2",
    add: (v: string, l: string) => v + " + " + l,
  },
  "lists-of-numbers": {
    setup: (n: number) =>
      `const a: number[] = [], b: number[] = [];\nfor (let i = 0; i < ${n}; i++) { a.push(i + 0.25); b.push(i * 7); }`,
    types: "a: number[], b: number[]",
    load: (i: number) => (i % 3 ? "a" : "b") + "[" + i + "]",
    zero: "0",
    use: (v: string) => v + " * 4",
    add: (v: string, l: string) => v + " + " + l,
  },
  "strings": {
    setup: (n: number) =>
      `const a: string[] = [], b: string[] = [];\nfor (let i = 0; i < ${n}; i++) { a.push("s" + i); b.push(String.fromCharCode(65 + i % 26) + i); }`,
    types: "a: string[], b: string[]",
    load: (i: number) => (i % 2 ? "a" : "b") + "[" + i + "]",
    zero: '"0"',
    use: (v: string) => v + ".length * 131 + " + v + ".charCodeAt(" + v + ".length - 1)",
    add: (v: string, l: string) => l,
  },
  "fields-of-objects": {
    setup: (n: number) =>
      `const a: { x: number, y: string }[] = [], b: { x: number, y: string }[] = [];\nfor (let i = 0; i < ${n}; i++) { a.push({ x: i + 0.5, y: "y" + i }); b.push({ x: i, y: "z" }); }`,
    types: "a: { x: number, y: string }[], b: { x: number, y: string }[]",
    load: (i: number) => (i % 2 ? "a" : "b") + "[" + i + "].x",
    zero: "0",
    use: (v: string) => v + " * 2",
    add: (v: string, l: string) => v + " + " + l,
  },
};
function body(k: any, n: number, order: string): string {
  const L: string[] = [];
  const use = (i: number) => "s = mix(s, " + k.use("v" + i) + ");";
  if (order === "made-then-used-forward" || order === "made-then-used-backward") {
    for (let i = 0; i < n; i++) L.push("const v" + i + " = " + k.load(i) + ";");
    if (order.endsWith("forward")) for (let i = 0; i < n; i++) L.push(use(i));
    else for (let i = n - 1; i >= 0; i--) L.push(use(i));
  } else if (order.startsWith("used-a-while-later")) {
    const d = order.endsWith("short") ? 40 : 3000;
    for (let i = 0; i < n; i++) {
      L.push("const v" + i + " = " + k.load(i) + ";");
      if (i >= d) L.push(use(i - d));
    }
    for (let i = Math.max(0, n - d); i < n; i++) L.push(use(i));
  } else if (order === "carried-round-a-loop") {
    for (let i = 0; i < n; i++) L.push("let v" + i + " = " + k.zero + ";");
    L.push("for (let turn = 0; turn < 3; turn++) {");
    for (let i = 0; i < n; i++) L.push("v" + i + " = " + k.add("v" + i, k.load((i + 1) % n)) + ";");
    L.push("s = mix(s, turn);", "}");
    for (let i = 0; i < n; i++) L.push(use(i));
  } else if (order === "read-in-a-handler") {
    for (let i = 0; i < n; i++) L.push("let v" + i + " = " + k.zero + ";");
    L.push("try {");
    for (let i = 0; i < n; i++) {
      L.push("v" + i + " = " + k.load(i) + ";");
      if (i === n >> 1) L.push('if (rare) throw new Error("rare");');
    }
    L.push("} catch (e) {", "s = mix(s, 5);");
    for (let i = n - 1; i >= 0; i--) L.push(use(i));
    L.push("}");
    for (let i = 0; i < n; i += 7) L.push(use(i));
  }
  return L.join("\n");
}
const strip = (t: string) => t.replace(/: (number|string)\[\]/g, "").replace(/: \{ x: number, y: string \}\[\]/g, "");
const orders = [
  "made-then-used-forward",
  "made-then-used-backward",
  "used-a-while-later-short",
  "used-a-while-later-long",
  "carried-round-a-loop",
  "read-in-a-handler",
];

export function generate(random: Random, typed: boolean): string {
  const k = random.pick(Object.values(kinds));
  const order = random.pick(orders);
  const n = random.pick([2000, 8000, 20000, 30000, 34000, 46000]);
  let s = (typed ? k.setup(n) : strip(k.setup(n))) + "\n";
  s += typed
    ? "function mix(s: number, v: number): number { return (s * 33 + v) % 1000000007; }\n"
    : "function mix(s, v) { return (s * 33 + v) % 1000000007; }\n";
  s +=
    "function big(" +
    (typed ? k.types + ", rare: boolean): number" : "a, b, rare)") +
    " {\nlet s = 1;\n" +
    body(k, n, order) +
    "\nreturn s;\n}\n";
  return s + "console.log(big(a, b, false));\nconsole.log(big(a, b, true));\n";
}

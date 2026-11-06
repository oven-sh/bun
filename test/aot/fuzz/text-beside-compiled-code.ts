// Text that becomes code at run time (new Function, direct and indirect eval, node:vm) works on objects that compiled code made and typed, and hands objects of its own making to compiled code.
//
//   subjects  instances of classes with fields of every kind, of a subclass with accessors, with private fields; literals, nested ones; objects with names added later, with index keys and a length;
//             arrays of integers, fractions, strings, objects, with holes; typed arrays; closures and functions with properties; objects without a prototype, with a made one; Maps; each also frozen, sealed, not extensible
//   text      reads, stores, adds, deletes, defines (values, accessors, attributes), asks `in`, lists keys, freezes, changes the prototype, calls, constructs, pushes, pops, sets lengths, stores another kind of element;
//             sloppy and strict; once, or in a loop of its own over objects that a compiled function makes for it
//   twice     every step runs on two to four objects of one shape, some on one object again
//   back      text makes literals, arrays, closures, instances of compiled classes, and compiled code reads them through declared types
//   locals    direct eval reads and writes the variables of the compiled function it stands in
//   shapes    generation after generation of objects with 4 to 16 names, some of them new in each generation, made by text or by compiled code and thrown away; the same few pieces of text store, add, read and delete on all of them
//
// In front of and behind every step compiled code reads the object through its declared type and describes it whole. One line a step.
// Always TypeScript: the mode `erased` gives the untyped form.
import type { Random } from "./random";

const prelude = `import vm from "node:vm";
type Text = (...values: any[]) => any;
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}
class Mixed {
  n = 1;
  d = 0.5;
  s = "s";
  b = true;
  o: Point | null = null;
  u: number | undefined = undefined;
  list: number[] = [1, 2];
  constructor(seed: number) {
    this.n = seed | 0;
    this.d = seed * 0.5;
    if (seed & 1) this.o = new Point(seed, 1);
    if (seed & 2) this.u = seed;
  }
}
class Sub extends Point {
  z = 3;
  #hidden = 7;
  get twice(): number {
    return this.z * 2 + this.#hidden;
  }
  set twice(value: number) {
    this.z = value;
  }
}
interface Row {
  a: number;
  b: string;
  c: number;
}
interface Nest {
  inner: { v: number };
  list: number[];
}
function short(value: any, depth: number): string {
  if (value === null) return "null";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function/" + value.length;
  if (typeof value === "symbol") return "symbol";
  if (typeof value !== "object") return String(value);
  return depth > 1 ? "{..}" : describe(value, depth + 1);
}
function describe(value: any, depth: number = 0): string {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return short(value, depth);
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof value === "function" && (key === "name" || key === "prototype" || key === "length")) continue;
    const found = Reflect.getOwnPropertyDescriptor(value, key)!;
    const marks = (found.enumerable ? "" : "h") + (found.configurable ? "" : "c") + ("value" in found ? (found.writable ? "" : "r") : "a");
    parts.push(String(key) + (marks && "~" + marks) + ":" + ("value" in found ? short(found.value, depth) : "accessor"));
  }
  const parent = Object.getPrototypeOf(value);
  const kind = parent === null ? "none" : parent === Object.prototype ? "" : Array.isArray(value) ? "array" : typeof value === "function" ? "function" : (parent.constructor?.name ?? "made");
  return kind + (Object.isFrozen(value) ? "!f" : Object.isSealed(value) ? "!s" : Object.isExtensible(value) ? "" : "!n") + "{" + parts.join(",") + "}" + (value instanceof Map ? "size" + value.size : "");
}
function tried(run: () => any): string {
  try {
    return describe(run());
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}
function usePoint(p: Point): string {
  return p.x + "," + p.y + "," + p.sum();
}
function useMixed(m: Mixed): string {
  return m.n + "," + m.d + "," + m.s + "," + m.b + "," + (m.o === null ? "null" : m.o.x) + "," + m.u + "," + m.list.length;
}
function useSub(s: Sub): string {
  return s.x + "," + s.z + "," + s.twice + "," + s.sum();
}
function useRow(r: Row): string {
  return r.a + "," + r.b + "," + r.c;
}
function useNest(n: Nest): string {
  return n.inner.v + "," + n.list.length + "," + n.list[0];
}
function useNumbers(list: number[]): string {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return list.length + "," + sum + "," + list[0];
}
function useStrings(list: string[]): string {
  return list.length + "," + list.join("|");
}
function usePoints(list: Point[]): string {
  let sum = 0;
  for (const each of list) sum += each.x;
  return list.length + "," + sum;
}
function useInts(list: Int32Array): string {
  return list.length + "," + list[0] + "," + list[list.length - 1];
}
function useCall(f: (a: number) => number): string {
  return String(f(3));
}
function useAny(value: any): string {
  return typeof value;
}
function useTable(table: Map<string, number>): string {
  return table.size + "," + table.get("a");
}
`;

interface Subject {
  name: string;
  make: string;
  use: string;
  names: string[];
  isList?: true;
  isCall?: true;
}

export function generate(random: Random): string {
  const below = (limit: number) => random.below(limit);
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude];
  const seed = () => pick(["i", "i + 1", "i * 3", `${below(9)}`]);
  // prettier-ignore
  const subjects: Subject[] = [
    { name: "point", make: `new Point(${seed()}, 2)`, use: "usePoint", names: ["x", "y", "sum"] },
    { name: "mixed", make: `new Mixed(${seed()})`, use: "useMixed", names: ["n", "d", "s", "b", "o", "u", "list"] },
    { name: "sub", make: `new Sub(${seed()}, 5)`, use: "useSub", names: ["x", "y", "z", "twice"] },
    { name: "row", make: `({ a: ${seed()}, b: "two", c: 3.5 }) as Row`, use: "useRow", names: ["a", "b", "c"] },
    { name: "nest", make: `({ inner: { v: ${seed()} }, list: [1, 2, 3] }) as Nest`, use: "useNest", names: ["inner", "list"] },
    { name: "grown", make: `((p: any) => ((p.extra = ${seed()}), (p.more = "m"), p))(new Point(1, 2))`, use: "usePoint", names: ["x", "y", "extra", "more"] },
    { name: "indexed", make: `((o: any) => ((o[0] = ${seed()}), (o[1] = "b"), (o.length = 2), o))({})`, use: "useAny", names: ["0", "1", "length"] },
    { name: "integers", make: `[${seed()}, 2, 3]`, use: "useNumbers", names: ["0", "1", "length"], isList: true },
    { name: "fractions", make: `[${seed()} + 0.5, 1.5]`, use: "useNumbers", names: ["0", "1", "length"], isList: true },
    { name: "strings", make: `["a", "b" + (${seed()})]`, use: "useStrings", names: ["0", "1", "length"], isList: true },
    { name: "points", make: `[new Point(${seed()}, 1), new Point(2, 2)]`, use: "usePoints", names: ["0", "1", "length"], isList: true },
    { name: "holes", make: `((list: number[]) => ((list[4] = ${seed()}), list))([1])`, use: "useNumbers", names: ["0", "2", "4", "length"], isList: true },
    { name: "ints", make: `new Int32Array([${seed()}, 2, 3])`, use: "useInts", names: ["0", "1", "5", "length"] },
    { name: "closure", make: `(k => (a: number): number => a + k)(${seed()})`, use: "useCall", names: ["name", "length", "own"], isCall: true },
    { name: "named", make: `((f: any) => ((f.own = ${seed()}), f))(function (a: number): number { return a * 2; })`, use: "useCall", names: ["own", "prototype", "length"], isCall: true },
    { name: "bare", make: `((o: any) => ((o.a = ${seed()}), (o.b = "b"), (o.c = 1.5), o))(Object.create(null))`, use: "useRow", names: ["a", "b", "c"] },
    { name: "heir", make: `((o: any) => ((o.c = ${seed()}), o))(Object.create({ a: 1, b: "up" }))`, use: "useRow", names: ["a", "b", "c"] },
    { name: "table", make: `new Map([["a", ${seed()}], ["b", 2]])`, use: "useTable", names: ["a", "size", "own"] },
  ];
  // An array of four thousand million holes takes minutes to walk.
  let isList = false;
  const value = () => pick(["1", "7", "-1", "0.5", "-0", "NaN", "2147483648", "-2147483649", '"text"', '""', "null", "undefined", "true", "{}", "[1]", "{ x: 1, y: 2 }", "Math.max", "1e300", "4294967295"].filter(each => !isList || (each !== "2147483648" && each !== "4294967295")));
  const makers = ["byFunction", "byIndirectEval", "byDirectEval", "byVm"];
  text.push(`function byFunction(names: string, body: string): Text {
  return new Function(...names.split(","), body) as Text;
}
function byIndirectEval(names: string, body: string): Text {
  return (0, eval)("(function (" + names + ") { " + body + " })");
}
function byDirectEval(names: string, body: string): Text {
  return eval("(function (" + names + ") { " + body + " })");
}
function byVm(names: string, body: string): Text {
  return vm.runInThisContext("(function (" + names + ") { " + body + " })");
}`);

  let step = 0;
  for (const subject of random.sample(subjects, random.between(3, 6))) {
    isList = !!subject.isList;
    const name = () => pick(subject.names);
    const fresh = () => pick(["w", "added", "z9", "10", "-1", "1.5", "length", "constructor", "__proto__x"]);
    const key = () => (below(3) ? name() : fresh());
    const dotted = (k: string) => (/^[A-Za-z_]\w*$/.test(k) ? `o.${k}` : `o[${JSON.stringify(k)}]`);
    // prettier-ignore
    const bodies = (): string => pick([
      () => `return ${dotted(name())};`, () => `return o[k];`, () => `return k in o;`, () => `return Object.keys(o).join();`, () => `var s = ""; for (var p in o) s += p + ","; return s;`, () => `return JSON.stringify(o);`,
      () => `return Object.getOwnPropertyNames(o).join();`, () => `return typeof ${dotted(name())};`, () => `return Object.getOwnPropertyDescriptor(o, k);`, () => `return o.hasOwnProperty ? o.hasOwnProperty(k) : "none";`,
      () => `${dotted(name())} = v; return ${dotted(name())};`, () => `${dotted(name())} = v; return ${dotted(name())};`, () => `o[k] = v; return o[k];`, () => `${dotted(name())} += v; return o;`, () => `${dotted(name())}++; return o;`,
      () => `${dotted(fresh())} = v; return o;`, () => `${dotted(fresh())} = v; return o;`, () => `${dotted(fresh())} = v; ${dotted(fresh())} = v; ${dotted(name())} = v; return o;`, () => `o["n" + k] = v; return o;`,
      () => `return delete ${dotted(name())};`, () => `delete o[k]; return o;`, () => `delete ${dotted(name())}; ${dotted(name())} = v; return o;`, () => `${dotted(fresh())} = v; delete ${dotted(name())}; return o;`,
      () => `Object.defineProperty(o, k, { value: v, writable: ${pick(["true", "false"])}, enumerable: ${pick(["true", "false"])}, configurable: true }); return o;`, () => `Object.defineProperty(o, k, { get: function () { return v; }, configurable: true }); return o[k];`,
      () => `Object.defineProperty(o, k, { get: function () { return v; }, set: function (x) { this.seen = x; }, configurable: true, enumerable: true }); o[k] = 1; return o;`, () => `Object.defineProperty(o, k, { enumerable: false }); return o;`, () => `Object.defineProperty(o, k, { writable: false }); o[k] = v; return o;`,
      () => `Object.${pick(["freeze", "seal", "preventExtensions"])}(o); ${dotted(key())} = v; return o;`, () => `return [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)].join();`, () => `Object.setPrototypeOf(o, { inherited: v }); return o.inherited;`,
      () => `return Object.assign({}, o);`, () => `return Object.assign(o, { ${pick(["w", "x", "a", "n"])}: v });`, () => `var c = {}; for (var p in o) c[p] = o[p]; c.length = v; return c;`, () => `return Object.entries(o).length;`, () => `return new o.constructor(1, 2);`,
      () => `o[Symbol.for("s")] = v; return o;`, () => `return Reflect.ownKeys(o).length;`, () => `return Reflect.set(o, k, v) + "," + Reflect.has(o, k) + "," + Reflect.deleteProperty(o, k);`,
      ...(subject.isList ? [() => `o.push(v); return o;`, () => `return o.pop();`, () => `o.unshift(v); return o;`, () => `o.length = ${pick(["0", "1", "5"])}; return o;`, () => `o[o.length + 2] = v; return o;`, () => `o.reverse(); return o;`, () => `o.splice(1, 1, v, v); return o;`,
        () => `o.fill(v); return o;`, () => `return o.map(function (e) { return e; });`, () => `return o.concat(o, [v]);`, () => `o[0] = v; o[1] = v; return o;`, () => `return o.indexOf(v) + "," + o.includes(v);`, () => `o.push(v, v, v, v, v, v, v, v); return o.length;`, () => `return o.slice(1);`] : []),
      ...(subject.isCall ? [() => `return o(v);`, () => `return o.call(null, 2) + o.apply(null, [3]);`, () => `return o.bind(null, 4)();`, () => `o.own = v; return o.own;`] : []),
    ])();
    const guard = subject.name === "ints" ? pick(["", "Object.preventExtensions"]) : pick(["", "", "", "Object.freeze", "Object.seal", "Object.preventExtensions"]);
    const made = guard ? `${guard}(${subject.make})` : subject.make;
    text.push(`function make_${subject.name}(i: number): any {\n  return ${made};\n}`);
    for (let steps = random.between(3, 8); steps--; ) {
      const strict = below(3) ? "" : '"use strict"; ';
      const label = `${subject.name}${guard ? "!" : ""} ${step}`;
      const f = "text" + step++;
      switch (below(8)) {
        case 0: {
          // The text has the loop, and a compiled function makes the objects.
          text.push(`const ${f} = ${pick(makers)}("make,v,k", ${JSON.stringify(`${strict}var all = []; for (var i = 0; i < ${pick([2, 3, 9, 40])}; i++) { var o = make(i); all.push((function () { ${bodies()} })()); } return all[all.length - 1];`)});
console.log(${JSON.stringify(label)} + " in a loop " + tried(() => ${f}(make_${subject.name}, ${value()}, ${JSON.stringify(key())})));`);
          break;
        }
        case 1: {
          // One object, the same text again and again.
          text.push(`const ${f} = ${pick(makers)}("o,v,k", ${JSON.stringify(strict + bodies())});
{
  const one = make_${subject.name}(1);
  for (const v of [${value()}, ${value()}, ${value()}]) console.log(${JSON.stringify(label)} + " again " + tried(() => ${f}(one, v, ${JSON.stringify(key())})) + " | " + tried(() => ${subject.use}(one)) + " | " + describe(one));
}`);
          break;
        }
        default:
          text.push(`const ${f} = ${pick(makers)}("o,v,k", ${JSON.stringify(strict + bodies())});
for (let i = 0; i < ${random.between(2, 4)}; i++) {
  const one = make_${subject.name}(i);
  const before = tried(() => ${subject.use}(one));
  console.log(${JSON.stringify(label)} + " " + before + " | " + tried(() => ${f}(one, ${value()}, ${JSON.stringify(key())})) + " | " + tried(() => ${subject.use}(one)) + " | " + describe(one));
}`);
      }
    }
  }

  isList = false;
  // What the text makes goes to compiled code.
  // prettier-ignore
  const gifts: [string, string][] = [["return { x: v, y: 2, sum: function () { return this.x + this.y; } };", "usePoint"], ["return new P(v, 3);", "usePoint"], ["var p = new P(v, 3); p.extra = v; return p;", "usePoint"], ["var p = new P(1, 2); delete p.x; p.x = v; return p;", "usePoint"],
    ["return { a: v, b: 'b', c: 2.5 };", "useRow"], ["return { c: 1, b: 'b', a: v };", "useRow"], ["var r = {}; r.a = v; r.b = 'b'; r.c = v; return r;", "useRow"], ["return [v, 2, 3];", "useNumbers"], ["return [v, 0.5];", "useNumbers"], ["var l = []; l[3] = v; return l;", "useNumbers"], ["return ['a', String(v)];", "useStrings"],
    ["return [new P(v, 1), new P(2, 2)];", "usePoints"], ["return function (a) { return a + v; };", "useCall"], ["return new Int32Array([v, 2]);", "useInts"], ["return new Map([['a', v]]);", "useTable"], ["return { inner: { v: v }, list: [v] };", "useNest"], ["return Object.freeze({ a: v, b: 'f', c: 0 });", "useRow"]];
  for (const [body, use] of random.sample(gifts, random.between(3, 7))) {
    const f = "text" + step++;
    text.push(`const ${f} = ${pick(makers)}("v,P", ${JSON.stringify((below(3) ? "" : '"use strict"; ') + body)});
for (const v of [1, 2.5, ${pick(["-1", "2147483648", "0"])}]) console.log("made by text ${step} " + tried(() => ${use}(${f}(v, Point))) + " | " + tried(() => ${f}(v, Point)));`);
  }

  // Shapes come, die with their objects and come again, while the same text goes on working on them.
  for (let blocks = random.between(1, 2); blocks--; ) {
    const [id, names, generations, shapes] = [step++, random.between(4, 14), pick([10, 30, 80]), random.between(1, 6)];
    const maker = pick(makers);
    // prettier-ignore
    const born = pick([
      `${maker}("base", "var o = { " + parts.join(", ") + " }; return o;")`,
      `${maker}("base", "var o = {}; " + parts.map(part => "o." + part.replace(": ", " = ") + ";").join(" ") + " return o;")`,
      `((list: string[]) => (base: number): any => { const o: any = ${pick(["{}", "new Point(base, 1)", "Object.create(null)", "[]"])}; for (const part of list) o[part.slice(0, part.indexOf(":"))] = base; return o; })(parts)`,
    ]);
    text.push(`{
  const writers: Text[] = [], readers: Text[] = [], removers: Text[] = [];
  for (let t = 0; t < ${names}; t++) {
    writers.push(${pick(makers)}("o,v", "o.w" + t + " = v; return o;"));
    readers.push(${pick(makers)}("o", "return o.w" + t + ";"));
    removers.push(${pick(makers)}("o", "return delete o.w" + t + ";"));
  }
  let state = ${1 + below(100000)};
  const next = (n: number): number => ((state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff) >>> 8) % n;
  let hash = 0;
  for (let g = 0; g < ${generations}; g++) {
    for (let s = 0; s < ${shapes}; s++) {
      const parts: string[] = [];
      for (let t = 0; t < ${names}; t++) {
        if (next(4) !== 0) parts.push("w" + t + ": base + " + t);
        if (next(3) === 0) parts.push("g" + g + "s" + s + "x" + t + ": " + (2000 + t));
      }
      const make: Text = ${born};
      const one = make(g), twin = make(g + 5);
      for (let t = 0; t < ${names}; t++) {
        const kept = { id: g + t };
        for (let k = 0, turns = 1 + next(${pick([3, 20, 300])}); k < turns; k++) writers[t](twin, ${pick(["kept", "k", "k * 0.5", '"s" + k'])});
        if (next(5) === 0) removers[t](one);
        hash = (Math.imul(hash, 31) + short(readers[t](one), 2).length + short(readers[t](twin), 2).length) | 0;
      }
      hash = (Math.imul(hash, 31) + describe(one).length + describe(twin).length) | 0;
    }
    if (g % 10 === 9) console.log("shapes ${id} generation " + g + " " + hash);
  }
}`);
  }

  // Direct eval among the variables of a compiled function.
  // prettier-ignore
  const among = ["local + a", "local = local + a; local", "kept.x = local; kept.x + kept.y", "kept.x++; kept.sum()", "word + local", "word = word + 'w'; word.length", "list.push(local); list.length", "list[0] = 0.5; list[0]", "typeof missing", "(function () { return local * 2; })()", "[local, a, word].join()",
    "kept = { x: 9, y: 9, sum: function () { return 1; } }; kept.x", "flag = !flag; flag", "var fresh = local + 1; fresh", "(() => { local += 5; return local; })()", "delete kept.y; kept.y", "kept.added = a; kept.added"];
  for (let count = random.between(2, 5); count--; ) {
    const f = "among" + step++;
    text.push(`function ${f}(a: number, source: string): string {
  let local = a * 2;
  let word = "w" + a;
  let kept = new Point(a, 1);
  let flag = a > 1;
  const list = [a, 2];
  const first = tried(() => eval(source));
  const second = tried(() => eval(source));
  return first + " " + second + " | " + local + "," + word + "," + tried(() => usePoint(kept)) + "," + flag + "," + useNumbers(list);
}
for (let i = 0; i < 3; i++) console.log("among the variables ${step} " + ${f}(i, ${JSON.stringify(pick(among))}));`);
  }
  return text.join("\n");
}

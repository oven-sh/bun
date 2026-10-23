// Values of every width and kind that stay alive across joins: what a code generator moves between registers and frame slots where paths meet, and what it has to find again behind a call, a throw or a wait.
//
//   values    6 to 900 variables a function, some of them parameters, each of one kind for good: int32, uint32, an integer wider than 32 bits, double, any number in turn, boolean, string, one of four literal strings,
//             an object of a class, one of three subclasses behind their base, an array of objects, a Map, a typed array of each element width or an array, `T | undefined` and `T | null` of these, anything in turn
//   edges     the ends of int32 and their neighbors, the ends of the safe integers, -0, NaN with every payload a typed array can hold
//   joins     both arms of an if, or all arms of a switch, assign the same 6 to 64 variables, mostly by copies of one another; rotations and other permutations of 2 to 40 variables, alone, in loops and in the step of a loop whose test still reads others
//   flow      if, the same test twice, for, while, do, for-of, switch that falls through, with 16 cases, with cases that share a target, with one to three cases at the end of a loop's body, on strings; labelled blocks and loops; all of it inside try, catch and finally too; return, break and continue that leave through a finally
//   throws    by a callee, two or three frames below or in the engine itself, with a number, a double, a string or an object, into a handler that reads what was assigned on the way, or out of the function through its finally blocks
//   calls     functions the compiler cannot look through, with up to 14 parameters of mixed kinds, in tail position too; one that fills the stack below with bytes of every kind; the function itself; an earlier function; closures that write variables
//   waits     half of the functions are generators, async functions or async generators. Generators are also closed early and thrown into; three calls of an async function are in flight at once
//
// Every function is called some hundred times with other arguments. All its variables go into one number at the end, and single ones on the way. Two lines a function.
// Always TypeScript: the mode `erased` gives the untyped form. A variable of a union type is read through a cast to that type, so that no narrowing of the checker's makes a read an error.
import type { Random } from "./random";

type Kind = "int" | "uint" | "wide" | "double" | "number" | "flag" | "text" | "word" | "box" | "shape" | "boxes" | "table" | "memory" | "maybeInt" | "maybeDouble" | "maybeFlag" | "maybeText" | "maybeBox" | "any";
type Form = "plain" | "generator" | "async" | "asyncGenerator";
interface Variable {
  name: string;
  kind: Kind;
  type: string;
}

const prelude = `type Word = "red" | "green" | "blue" | "";
const words: Word[] = ["red", "green", "blue", ""];
class Box {
  d: number;
  w: number;
  u: number;
  on: boolean;
  tag: Word;
  name: string;
  some: number | undefined;
  ratio: number | null;
  flagged: boolean | undefined;
  label: string | undefined;
  constructor(
    public n: number,
    public next: Box | null,
  ) {
    this.d = n * 0.5;
    this.w = n * 4294967296 + 7;
    this.u = n >>> 0;
    this.on = (n & 1) === 0;
    this.tag = words[n & 3];
    this.name = "b";
    this.some = n & 2 ? n : undefined;
    this.ratio = n & 4 ? n * 0.25 : null;
    this.flagged = n & 8 ? (n & 1) === 1 : undefined;
    this.label = n & 16 ? "l" : undefined;
  }
}
abstract class Shape {
  constructor(public id: number) {}
  abstract area(k: number): number;
  get twice(): number {
    return this.id * 2;
  }
  grown(by: number): Shape {
    this.id = (this.id + by) | 0;
    return this;
  }
}
class Square extends Shape {
  constructor(
    id: number,
    public side: number,
  ) {
    super(id);
  }
  area(k: number): number {
    return (Math.imul(this.side, this.side) + k) | 0;
  }
}
class Disc extends Shape {
  constructor(
    id: number,
    public r: number,
  ) {
    super(id);
  }
  area(k: number): number {
    return this.r * 3.25 + k;
  }
}
class Strip extends Shape {
  constructor(
    id: number,
    public from: Box,
    public label: string,
  ) {
    super(id);
  }
  area(k: number): number {
    return (this.from.n + this.label.length + k) | 0;
  }
  get twice(): number {
    return this.from.w;
  }
}
function shapeOf(x: number, box: Box): Shape {
  tick();
  return x % 3 === 0 ? new Square(x, x & 255) : x % 3 === 1 || x % 3 === -1 ? new Disc(x, x * 0.5) : new Strip(x, box, "s" + (x & 3));
}
const odd = new Float64Array(
  new BigUint64Array([0x7ffa000000000000n, 0x7ffb000000000000n, 0x7ffc000000000000n, 0xfffa000000000000n, 0x7ff8000000000000n, 0x7ff0000000000000n, 0x8000000000000000n, 0xfffe000000000001n]).buffer,
);
let calls = 0;
let sink = 0;
function tick(): void {
  if (++calls % 977 === 0)
    try {
      throw calls;
    } catch {}
}
function fold(value: any): number {
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? 13 : value !== value ? 17 : value === Infinity ? 19 : value === -Infinity ? 23 : ((value * 1000) | 0) ^ ((value / 4294967296) | 0);
    case "boolean":
      return value ? 3 : 5;
    case "string":
      return value.length * 31 + (value.charCodeAt(0) | 0);
    case "undefined":
      return 7;
    default:
      if (value === null) return 11;
      if (value instanceof Box) return foldBox(value) ^ (value.next === null ? 0 : Math.imul(foldBox(value.next), 31));
      if (value instanceof Shape) return value.id ^ fold(value.area(1)) ^ fold(value.twice);
      if (value instanceof Map) {
        let sum = value.size;
        for (const [key, held] of value) sum = (Math.imul(sum, 31) + fold(key) + fold(held)) | 0;
        return sum;
      }
      let sum = 0;
      for (let i = 0; i < value.length; i++) sum = (Math.imul(sum, 31) + fold(value[i])) | 0;
      return sum;
  }
}
function foldBox(box: Box): number {
  return box.n ^ fold(box.d) ^ fold(box.w) ^ fold(box.u) ^ fold(box.on) ^ fold(box.tag) ^ fold(box.name) ^ fold(box.some) ^ fold(box.ratio) ^ fold(box.flagged) ^ fold(box.label);
}
function note(value: any): void {
  tick();
  sink = (Math.imul(sink, 31) + fold(value)) | 0;
}
function opaqueInt(x: number, y: number): number {
  tick();
  return (x * 3 - y) | 0;
}
function opaqueWide(x: number, y: number): number {
  tick();
  return (x % 4503599627370496) + y;
}
function opaqueDouble(x: number, y: number): number {
  tick();
  return x * 0.75 + y;
}
function opaqueText(x: string, y: number): string {
  tick();
  return (x + (y & 7)).slice(-5);
}
function opaqueWord(x: number): Word {
  tick();
  return words[x & 3];
}
function opaqueBox(x: Box, y: number): Box {
  tick();
  return y & 1 ? x : new Box(y | 0, null);
}
function opaqueMaybe(x: number): number | undefined {
  tick();
  return x & 1 ? undefined : x;
}
function opaqueAny(x: any): any {
  tick();
  return x;
}
function mayThrow(x: number): number {
  tick();
  switch (x & 31) {
    case 5:
      throw x;
    case 11:
      throw new Box(x, null);
    case 17:
      throw String(x & 255);
    case 23:
      throw x * 0.5;
  }
  return (x + 1) | 0;
}
function throwsFromBelow(x: number, deeper: number): number {
  const i0 = x ^ 21845, i1 = (x + 77) | 0, i2 = Math.imul(x, 31), i3 = x >> 1, i4 = ~x, i5 = (x - 9) | 0, d0 = x * 0.5, d1 = x + 0.25; // prettier-ignore
  const below = deeper > 0 ? throwsFromBelow(x, deeper - 1) : mayThrow(x);
  return (below ^ i0 ^ i1 ^ i2 ^ i3 ^ i4 ^ i5 ^ fold(d0) ^ fold(d1)) | 0;
}
function scribble(x: number, deeper: number): number {
  const i0 = ~x, i1 = x ^ -1431655766, i2 = (x - 2147483647) | 0, i3 = x | -65536, i4 = -x | 0, i5 = x ^ 1431655765; // prettier-ignore
  const w0 = x * 4294967296 - 1, w1 = -9007199254740991 + x, w2 = x * 1099511627776 + 4294967295; // prettier-ignore
  const d0 = x * -1.5e300, d1 = 0 / (x & 1), d2 = -1 / (x + 0.5), d3 = x + 1e-300; // prettier-ignore
  const b0 = new Box(x, null), t0 = String(x), f0 = x > 3, f1 = x < 3; // prettier-ignore
  const below = deeper > 0 ? scribble(x + 1, deeper - 1) : opaqueInt(x, 1);
  return (below ^ i0 ^ i1 ^ i2 ^ i3 ^ i4 ^ i5 ^ fold(w0) ^ fold(w1) ^ fold(w2) ^ fold(d0) ^ fold(d1) ^ fold(d2) ^ fold(d3) ^ b0.n ^ t0.length ^ fold(f0) ^ fold(f1)) | 0;
}
async function later(x: number): Promise<number> {
  tick();
  return (x + 1) | 0;
}
async function laterOrNever(x: number): Promise<number> {
  tick();
  if ((x & 15) === 9) throw x;
  return (x + 1) | 0;
}
function* some(count: number): Generator<number, number, number> {
  let sum = 0;
  for (let i = 0; i < count; i++) sum = (sum + (yield i)) | 0;
  return sum;
}
async function* someLater(count: number): AsyncGenerator<number, number, unknown> {
  for (let i = 0; i < count; i++) yield await later(i);
  return count;
}
function drained(steps: Generator<number, number, number>, stop: number): number {
  let sum = 0;
  try {
    let step = steps.next(0);
    for (let turn = 0; !step.done; turn++) {
      sum = (Math.imul(sum, 31) + step.value) | 0;
      step = turn !== stop ? steps.next(sum & 7) : stop & 1 ? steps.return(sum) : steps.throw(sum & 255);
    }
    return (Math.imul(sum, 31) + step.value) | 0;
  } catch (thrown) {
    return (sum ^ fold(thrown)) | 0;
  }
}
async function drainedLater(steps: AsyncGenerator<number, number, number>, stop: number): Promise<number> {
  let sum = 0;
  try {
    let step = await steps.next(0);
    for (let turn = 0; !step.done; turn++) {
      sum = (Math.imul(sum, 31) + step.value) | 0;
      step = await (turn !== stop ? steps.next(sum & 7) : stop & 1 ? steps.return(sum) : steps.throw(sum & 255));
    }
    return (Math.imul(sum, 31) + step.value) | 0;
  } catch (thrown) {
    return (sum ^ fold(thrown)) | 0;
  }
}
function settled(result: PromiseSettledResult<number>): number {
  return result.status === "fulfilled" ? result.value : fold(result.reason) + 1;
}
`;

const types: Record<Exclude<Kind, "memory">, string> = {
  int: "number", uint: "number", wide: "number", double: "number", number: "number", flag: "boolean", text: "string", word: "Word", box: "Box", shape: "Shape", boxes: "Box[]", table: "Map<number, number>", any: "any",
  maybeInt: "number | undefined", maybeDouble: "number | null", maybeFlag: "boolean | undefined", maybeText: "string | undefined", maybeBox: "Box | null",
}; // prettier-ignore
const memories = ["Int8Array", "Uint8Array", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "number[]"];
const edgesOfInt = ["-2147483648", "-2147483647", "-2147483646", "-2147483645", "-2147483644", "-2147483643", "2147483647", "2147483646", "-1", "0", "1", "65535", "-32769", "255"];
const edgesOfWide = ["9007199254740991", "-9007199254740991", "4503599627370495", "-4503599627370496", "2251799813685248", "2147483648", "-2147483649", "4294967295", "4294967296", "1099511627775"];

export function generate(random: Random): string {
  const below = (limit: number) => random.below(limit);
  const text: string[] = [prelude];
  const notes: string[] = [];
  const functions = random.between(2, 5);

  const mixes = Array.from({ length: 5 }, (_, number) => {
    const takes = Array.from({ length: random.pick([3, 5, 7, 9, 14]) }, () => random.pick<Exclude<Kind, "memory">>(["int", "int", "double", "double", "wide", "uint", "flag", "text", "word", "box", "maybeInt", "maybeDouble", "maybeBox"]));
    const gives = random.pick(["int", "int", "double", "double", "wide", "uint", "flag", "text", "word", "box", "maybeInt", "maybeDouble", "maybeBox"] as const);
    // prettier-ignore
    const given = { int: "all", uint: "all >>> 0", double: "all * 0.125", wide: "all * 2097152 + 5", flag: "(all & 1) === 0", text: "String(all & 1023)", word: "words[all & 3]", box: "new Box(all, null)",
      maybeInt: "all & 1 ? all : undefined", maybeDouble: "all & 1 ? all * 0.5 : null", maybeBox: "all & 1 ? new Box(all, null) : null" }[gives];
    text.push(`function mix${number}(${takes.map((kind, index) => `p${index}: ${types[kind]}`).join(", ")}): ${types[gives]} {
  tick();
  const all = (${takes.map((_, index) => `Math.imul(fold(p${index}), ${index * 2 + 3})`).join(" ^ ")}) | 0;
  return ${given};
}`);
    return { name: "mix" + number, takes, gives: gives as Kind };
  });
  const earlier: { name: string; takes: Kind[] }[] = [];

  for (let number = 0; number < functions; number++) {
    // prettier-ignore
    const [count, depth, size] = random.weighted([[3, [6, 3, 40]], [4, [12, 4, 80]], [4, [24, 5, 160]], [4, [48, 5, 260]], [2, [120, 4, 300]], [1, [400, 3, 200]], [1, [900, 2, 120]]] as const);
    const mix = random.pick<readonly (readonly [number, Kind])[]>([
      [[3, "int"], [2, "double"], [2, "wide"], [1, "uint"], [1, "number"]],
      [[1, "int"], [6, "double"]],
      [[2, "int"], [2, "box"], [2, "maybeBox"], [1, "text"], [1, "word"], [1, "maybeText"]],
      [[2, "int"], [2, "maybeInt"], [2, "maybeDouble"], [1, "maybeFlag"], [1, "flag"], [1, "double"]],
      [[2, "int"], [1, "uint"], [1, "wide"], [2, "memory"], [1, "double"]],
      [[2, "int"], [2, "shape"], [1, "boxes"], [1, "table"], [1, "box"], [1, "maybeBox"], [1, "text"], [1, "double"]],
      [[2, "int"], [1, "uint"], [1, "wide"], [1, "double"], [1, "number"], [1, "flag"], [1, "text"], [1, "word"], [1, "box"], [1, "shape"], [1, "boxes"], [1, "table"], [1, "memory"], [1, "maybeInt"], [1, "maybeDouble"], [1, "maybeFlag"], [1, "maybeText"], [1, "maybeBox"], [1, "any"]],
      [[2, "int"], [1, "uint"], [1, "wide"], [1, "double"], [1, "number"], [1, "flag"], [1, "text"], [1, "word"], [1, "box"], [1, "shape"], [1, "boxes"], [1, "table"], [1, "memory"], [1, "maybeInt"], [1, "maybeDouble"], [1, "maybeFlag"], [1, "maybeText"], [1, "maybeBox"], [1, "any"]],
    ]); // prettier-ignore
    const variables: Variable[] = Array.from({ length: count }, (_, index) => {
      const kind = index < 2 ? "int" : random.weighted(mix);
      return { name: "v" + index, kind, type: kind === "memory" ? random.pick(memories) : types[kind] };
    });
    const isUnion = (kind: Kind) => kind.startsWith("maybe") || kind === "word";
    const read = (variable: Variable) => (isUnion(variable.kind) ? `(${variable.name} as ${variable.type})` : variable.name);
    const drawn = (kind: Kind) => {
      const all = variables.filter(each => each.kind === kind);
      return all.length ? all[below(all.length)] : undefined;
    };
    const of = (kind: Kind) => {
      const variable = drawn(kind);
      return variable && read(variable);
    };
    const int = () => drawn("int")!.name;
    const form: Form = random.weighted([[4, "plain"], [2, "generator"], [2, "async"], [1, "asyncGenerator"]] as const);
    const name = "f" + number;
    // The first variables are parameters behind `a` and `b`.
    const parameters = variables.slice(0, random.pick([0, 0, 2, 4, 7, 12, 24])).filter(each => each.kind !== "memory");
    let budget = size;
    let names = 0;
    let guards = 0;
    let callsItself = false;
    let callsEarlier = 0;
    const closures: string[] = [];

    const value = (kind: Kind): string => {
      const [a, b, c] = [int(), int(), int()];
      const [u, w, d, x] = [of("uint") ?? `(${a} >>> 0)`, of("wide") ?? a, of("double") ?? a, of("number") ?? b];
      const [f, t, k, o, y] = [of("flag") ?? `(${a} > 0)`, of("text") ?? '"t"', of("word") ?? "(words[1] as Word)", of("box") ?? "spare", of("any") ?? a];
      const [mi, md, mf, mt, mo] = [of("maybeInt") ?? `(${o}.some as number | undefined)`, of("maybeDouble") ?? `(${o}.ratio as number | null)`, of("maybeFlag") ?? `(${o}.flagged as boolean | undefined)`, of("maybeText") ?? `(${o}.label as string | undefined)`, of("maybeBox") ?? `(${o}.next as Box | null)`]; // prettier-ignore
      const [s, bs, tb] = [of("shape") ?? "round", of("boxes") ?? "row", of("table") ?? "counts"];
      const mem = drawn("memory")?.name ?? "odd";
      const m = `${mem}[${a} & 7]`;
      const shift = () => random.pick(["1", "2", "3", "4", "9"]);
      const mixed = mixes.filter(each => each.gives === kind).map(each => `${each.name}(${each.takes.map(argument).join(", ")})`);
      // prettier-ignore
      switch (kind) {
        case "int":
          return random.pick([`(${a} + ${b}) | 0`, `(${a} - ${b}) | 0`, `Math.imul(${a}, ${b})`, `${a} ^ ${b}`, `${a} >> (${b} & 31)`, `${a} << (${b} & 31)`, `(${a} >>> (${b} & 31)) | 0`, `(${a} * 0.5 + ${b}) | 0`, `(${a} & ${b}) | 1`, `${a} > ${b} ? ${a} : ${b}`,
            `(${a} + ${below(100)}) | 0`, `(${a} / ((${b} & 15) + 1)) | 0`, `(${a} % ((${b} & 15) + 1)) | 0`, `(${a} % (${b} | 1)) | 0`, `(${a} / (${b} | 1)) | 0`, `~${a}`, `-${a} | 0`, `Math.clz32(${a})`, `Math.abs(${a}) | 0`, `Math.min(${a}, ${b}, ${c})`, `Math.max(${a}, ${b})`,
            random.pick(edgesOfInt), `(${a} + ${random.pick(edgesOfInt)}) | 0`, `(${d} * 3) | 0`, `${w} | 0`, `(${w} / 4294967296) | 0`, `${u} | 0`, `${x} | 0`, `${t}.length`, `${t}.charCodeAt(${a} & 3) | 0`, `${k}.length`, `${o}.n | 0`, `fold(${y})`, `${f} ? ${a} : ${b}`, `+${f}`,
            `(${mi} ?? ${b}) | 0`, `${mo}?.n ?? ${a}`, `${mo} === null ? ${a} : ${b}`, `${mf} === undefined ? ${a} : ${mf} ? ${b} : ${c}`, `(${mt} ?? "").length`, `((${md} ?? 0.5) * 2) | 0`, `${m} | 0`, `opaqueInt(${a}, ${b})`, `scribble(${a} & 7, ${below(3)})`,
            `(${a} + ${b} + ${c} + opaqueInt(${b}, ${c}) + ${a} + ${c}) | 0`, `${s}.area(${a}) | 0`, `${s}.id`, `${s}.twice | 0`, `(${s} instanceof Square ? (${s} as Square).side : ${a}) | 0`, `${s} instanceof Strip ? (${s} as Strip).from.n | 0 : ${b}`, `${bs}[${a} & 3].n | 0`, `${bs}[${a} & 3].next?.next?.n ?? ${b}`, `${bs}.length`,
            `(${tb}.get(${a} & 7) ?? ${b}) | 0`, `${tb}.size`, `${tb}.has(${a} & 7) ? ${a} : ${b}`, `${t}.indexOf("1")`, `(${t}[${a} & 1] ?? "x").length`, `(${o}.next as Box | null)?.next?.n ?? ${a}`, `opaqueInt(...([${a}, ${b}] as [number, number]))`,
            `${a} << ${b}`, `${a} >> ${b}`, `(${a} >>> ${b}) | 0`, `1 << (${a} & 31)`, `(${w} | 0) + (${u} | 0) | 0`, `Math.sign(${a})`, `(${w} % 256) | 0`, `${mem}[(${a} << ${random.pick(["1", "2", "3"])}) & 7] | 0`, `${mem}[((${a} << ${shift()}) >>> 0) % 8] | 0`, `${t}.charCodeAt((${a} << 1) & 3) | 0`,
            `(${a} / ${random.pick(["3", "7", "-1", "10", "16", "-5", "65536", "0"])}) | 0`, `(${a} % ${random.pick(["3", "8", "-1", "10", "1", "-7", "65536"])}) | 0`, `(${u} / ${random.pick(["3", "10", "2"])}) | 0`, `${u} % ${random.pick(["3", "10", "16"])}`,
            ...(guards || !below(6) ? [`mayThrow(${a})`, `throwsFromBelow(${a}, ${below(3)})`, `opaqueAny(${a} & 7 ? ${o} : null).n | 0`] : []), ...mixed, ...closures.map(each => `${each}(${a})`)]);
        case "uint":
          return random.pick([`${a} >>> 0`, `(${u} + ${a}) >>> 0`, `${u} >>> (${a} & 31)`, `(${u} * 3) >>> 0`, `Math.imul(${u}, ${a}) >>> 0`, `(${u} ^ ${a}) >>> 0`, "4294967295", "2147483648", "2147483647", `${o}.u`, `${f} ? ${u} : 4294967294`, `${w} >>> 0`, `(${u} << ${shift()}) >>> 0`, `(${a} << ${shift()}) >>> 0`, `~${u} >>> 0`, `${u} >>> ${a}`, `(${a} + ${b}) >>> 0`, `(${u} - ${a}) >>> 0`, `(${a} * ${random.pick(["2", "4", "8", "5"])}) >>> 0`, ...mixed]);
        case "wide":
          return random.pick([`${w} + ${a}`, `${w} - ${u}`, `${a} * 4294967296 + ${u}`, `(${w} * 3) % 9007199254740991`, `Math.floor(${w} / 3)`, `${a} * ${b}`, `${u} * 65537`, `${w} % 4294967296`, `-${w}`, `Math.abs(${w})`, `Math.trunc(${d} > 1e15 || ${d} < -1e15 || ${d} !== ${d} ? 1 : ${d})`,
            `${o}.w`, `${bs}[${a} & 3].w`, `Math.trunc(${s}.twice)`, `${w} > 4503599627370496 || ${w} < -4503599627370496 ? ${a} : ${w} * 2`, random.pick(edgesOfWide), `${a} + ${random.pick(edgesOfWide)}`, `opaqueWide(${w}, ${a})`, `${f} ? ${w} : ${a}`, `${f} ? ${w} : ${u}`, `${a} + ${b}`, `${u} + ${u}`, `${a} - ${u}`, `-${a}`, `${a} * ${random.pick(["3", "-1", "65537", "2147483647"])}`, `((${a} << ${shift()}) >>> 0) + ${w}`, `((${u} << ${shift()}) >>> 0) + ${u}`, `(${a} << ${shift()}) + ${w}`, `((${a} + ${b}) >>> 0) + ${w}`, `((${a} * 3) >>> 0) + ${u}`,
            `(${a} >>> ${shift()}) + ${w}`, `(${a} >> ${shift()}) + ${w}`, `(${w} | 0) + ${w}`, `(${w} >>> 0) + ${w}`, `${w} * ${random.pick(["2", "4", "8", "3"])} % 9007199254740991`, `${u} * ${random.pick(["2", "4", "8"])} + ${a}`, `${w} + ${random.pick(edgesOfWide)}`, ...mixed]);
        case "double":
          return random.pick([`${d} * 0.5 + ${a}`, `${d} - ${b} * 0.25`, `${a} / ((${b} & 7) + 1)`, `Math.sqrt(Math.abs(${d}))`, `${d} > 1e6 || ${d} < -1e6 ? 0.5 : ${d} * 1.5`, `opaqueDouble(${d}, ${a})`, `${f} ? ${d} : ${a} + 0.5`, `Math.floor(${d}) + 0.25`, `-${d}`,
            `${a} & 1 ? NaN : ${d}`, `${a} & 3 ? ${d} : -0`, `${d} * 0`, `(${a} & 7) / (${b} & 1)`, `${d} !== ${d} ? ${a} : ${d}`, `odd[${a} & 7]`, `${o}.d`, `${md} ?? ${d}`, `Math.fround(${d})`, `${w} / 3`, `${u} * 0.5`, `Math.min(${d}, ${a})`, `Math.max(${d}, ${w})`, `${m} * 0.5`,
            `${s}.area(${a}) * 0.5`, `${s} instanceof Disc ? (${s} as Disc).r : ${d}`, `${bs}[${a} & 3].d`, `(${tb}.get(${a} & 7) ?? ${d}) * 0.5`, `Math.round(${d}) - 0.5`, `Math.ceil(${d} * 0.1)`, `Math.trunc(${d}) * 0.5`, `Math.sign(${d}) * 0.5`, `Math.abs(${d})`, `${d} + ${a} * 0.1 + opaqueDouble(${d}, ${b}) - ${d}`, ...mixed]);
        case "number":
          return below(3) ? value(random.pick<Kind>(["int", "uint", "wide", "double", "double"])) : random.pick([`${f} ? ${a} : ${d}`, `${f} ? ${u} : ${w}`, `${f} ? ${w} : ${d}`, `${f} ? ${a} : ${u}`, `${f} ? ${x} : ${a}`, `${mi} ?? ${d}`, `${md} ?? ${a}`, `${f} ? ${a} : ${w}`]);
        case "flag":
          return random.pick([`${a} < ${b}`, `!${f}`, `${f} && ${a} > 3`, `${f} || ${d} < 0`, `${t} < "m"`, `${mo} === null`, `${y} === undefined`, `${a} === ${b}`, `${mf} ?? ${f}`, `${o}.on`, `${s} instanceof Square`, `${tb}.has(${a} & 7)`, `${bs}[${a} & 3] === ${o}`, `${bs}[${a} & 3].on`, `${k} === "green"`, `${d} !== ${d}`, `${u} > 2147483647`, `${w} > ${a}`, `${mi} === undefined`, `${x} < ${d}`, ...mixed]);
        case "text":
          return random.pick([`(${t} + "a").slice(-6)`, `String(${a} & 15)`, `(${t} + ${t}.length).slice(-4)`, `opaqueText(${t}, ${a})`, `${f} ? ${t} : "z"`, `${t}.slice(1) + "q"`, `\`\${${a} & 3}\${${t}.slice(0, 3)}\``, k, `${mt} ?? ${t}`, `${o}.name`, `${s} instanceof Strip ? (${s} as Strip).label : ${t}`, `${t}.toUpperCase().slice(0, 4)`, `${t}.padStart(3, "0").slice(-4)`, `${t}.at(-1) ?? ""`, `${bs}[${a} & 3].name`, `(${t} + ${k} + ${t}).slice(-5)`, `${f} ? ${k} : ${t}`,
            `\`\${${a} & 7}:\${${k}}:\${${f}}:\${${t}.slice(0, 2)}\`.slice(-7)`, `${f} ? "" : opaqueText(${t}, ${b})`, ...mixed]);
        case "word":
          return random.pick([`opaqueWord(${a})`, `words[${a} & 3]`, `${f} ? "red" : "blue"`, `${o}.tag`, k, `${f} ? ${k} : ""`, `${a} & 1 ? "green" : ${k}`, `${k} === "red" ? "green" : ${k}`, ...mixed]);
        case "box":
          return random.pick([`new Box(${a}, null)`, `new Box(${a}, ${mo})`, `${mo} ?? ${o}`, `opaqueBox(${o}, ${a})`, `${f} ? ${o} : spare`, o, `${bs}[${a} & 3]`, `${s} instanceof Strip ? (${s} as Strip).from : ${o}`, `(${o}.next as Box | null) ?? ${o}`, `${f} ? ((${o}.next as Box | null) ?? spare) : opaqueBox(${o}, ${b})`, ...mixed]);
        case "maybeInt":
          return random.pick([`${f} ? ${a} : undefined`, mi, `${o}.some`, "undefined as number | undefined", a, `${mi} === undefined ? ${a} : (${mi}! + 1) | 0`, `opaqueMaybe(${a})`, random.pick(edgesOfInt), `${f} ? ${random.pick(edgesOfInt)} : ${mi}`, `${a} & 3 ? ${mi} : ${b}`, ...mixed]);
        case "maybeDouble":
          return random.pick([`${f} ? ${d} : null`, md, `${o}.ratio`, "null as number | null", d, `odd[${a} & 7]`, `${md} === null ? ${d} : ${md}! * 0.5`, `${a} & 3 ? ${md} : ${a} + 0.5`, `${f} ? odd[${b} & 7] : ${md}`, `${f} ? -0 : null`, ...mixed]);
        case "maybeFlag":
          return random.pick([`${f} ? ${a} > ${b} : undefined`, mf, `${o}.flagged`, "undefined as boolean | undefined", f, `${mf} === undefined ? ${f} : !${mf}`, `${a} & 1 ? undefined : ${a} > ${b}`]);
        case "maybeText":
          return random.pick([`${f} ? ${t} : undefined`, mt, `${o}.label`, "undefined as string | undefined", t, k, `${mt} === undefined ? ${t} : ${mt}!.slice(1)`, `${a} & 1 ? undefined : ""`]);
        case "maybeBox":
          return random.pick([`${o}.next`, `${bs}[${a} & 3].next`, `(${o}.next as Box | null)?.next ?? null`, `${f} ? ${o} : null`, mo, "null as Box | null", o, `${mo}?.next ?? null`, `${a} & 3 ? ${mo} : new Box(${b}, null)`, `${f} ? ${mo} : opaqueBox(${o}, ${a})`, ...mixed]);
        case "shape":
          return random.pick([`shapeOf(${a}, ${o})`, `new Square(${a}, ${b})`, `new Disc(${a}, ${d})`, `new Strip(${a}, ${o}, ${t})`, s, `${f} ? ${s} : round`, `${s}.grown(${a} & 3)`, `${a} & 1 ? new Square(${b}, ${a}) : new Disc(${b}, ${d})`]);
        case "boxes":
          return random.pick([bs, `[${o}, ${o}, spare, ${mo} ?? ${o}]`, `${f} ? ${bs} : row`, `[${bs}[1], ${bs}[2], ${bs}[3], ${bs}[0]]`, `${bs}.slice()`]);
        case "table":
          return random.pick([tb, `new Map([[${a} & 7, ${b}], [${b} & 7, ${d}]])`, `${f} ? ${tb} : counts`, `${tb}.set(${a} & 7, ${x})`]);
        case "memory":
          return "odd";
        default:
          return random.pick([a, u, w, d, t, k, o, f, mi, md, mo, "undefined", "null", `opaqueAny(${y})`, `${f} ? ${a} : ${t}`, `${y} ?? ${o}`, `typeof ${y} === "number" ? ${y} + 1 : ${a}`, `odd[${a} & 7]`, random.pick(edgesOfInt), random.pick(edgesOfWide)]);
      }
    };
    // What is handed to a parameter: mostly a variable as it is.
    function argument(kind: Kind): string {
      const variable = below(4) ? of(kind) : undefined;
      if (variable) return variable;
      const [a, o] = [int(), of("box") ?? "spare"];
      // prettier-ignore
      return { int: a, uint: `${a} >>> 0`, wide: `${a} * 65536`, double: `${a} * 0.5`, number: a, flag: `${a} > 0`, text: '"s"', word: `words[${a} & 3]`, box: o, shape: "round", boxes: "row", table: "counts", memory: "odd", any: a,
        maybeInt: `${a} & 1 ? ${a} : undefined`, maybeDouble: `${a} & 1 ? ${a} * 0.5 : null`, maybeFlag: `${a} & 1 ? true : undefined`, maybeText: `${a} & 1 ? "s" : undefined`, maybeBox: `${a} & 1 ? ${o} : null` }[kind];
    }
    const store = (variable: Variable): string => {
      if (variable.kind !== "memory") return `${variable.name} = ${value(variable.kind)};`;
      const twin = variables.filter(each => each.type === variable.type && each !== variable);
      if (twin.length && !below(5)) return `${variable.name} = ${int()} & 1 ? ${random.pick(twin).name} : ${variable.name};`;
      return `${variable.name}[${int()} & 7] = ${value(variable.type.startsWith("Float") ? "double" : variable.type === "number[]" ? "number" : random.pick<Kind>(["int", "int", "uint", "wide", "double"]))};`;
    };
    const copy = (variable: Variable): string => {
      const twin = variables.filter(each => each.type === variable.type && each.kind === variable.kind && each !== variable);
      return twin.length ? `${variable.name} = ${random.pick(twin).name};` : store(variable);
    };
    const fields: [string, Kind][] = [["n", "int"], ["d", "double"], ["w", "wide"], ["u", "uint"], ["on", "flag"], ["tag", "word"], ["name", "text"], ["some", "maybeInt"], ["ratio", "maybeDouble"], ["flagged", "maybeFlag"], ["label", "maybeText"], ["next", "maybeBox"]]; // prettier-ignore
    const assign = () => {
      const o = drawn("box");
      if (o && !below(8)) {
        const [field, kind] = random.pick(fields);
        return `${o.name}.${field} = ${value(kind)};`;
      }
      const [bs, tb, s] = [drawn("boxes"), drawn("table"), drawn("shape")];
      if (bs && !below(12)) return `${bs.name}[${int()} & 3] = ${value("box")};`;
      if (tb && !below(12)) return random.pick([`${tb.name}.set(${int()} & 7, ${value("number")});`, `${tb.name}.delete(${int()} & 7);`]);
      if (s && !below(12)) return `${s.name}.id = ${value("int")};`;
      if (o && !below(16)) return `({ n: ${int()}, on: ${drawn("flag")?.name ?? "sunk"} } = ${o.name});`;
      return store(variables[below(count)]);
    };
    const condition = () => {
      const [a, b] = [int(), int()];
      // prettier-ignore
      return random.pick([`${a} ${random.pick(["<", ">", "<=", "!==", "==="])} ${below(3) ? b : below(50)}`, `${a} ${random.pick(["<", ">"])} ${b}`, of("flag") ?? `${a} & 1`, `${of("double") ?? a} < ${b}`, `${of("text") ?? '"k"'} < "k"`, `${of("box") ?? "spare"}.n > ${b}`,
        of("any") ? `typeof ${of("any")} === "${random.pick(["number", "string", "object", "undefined"])}"` : `${a} & 2`, `${a} > ${b} && ${b} > ${below(20)}`, `${a} < 0 || ${b} < 0`, `${of("maybeInt") ?? "(spare.some as number | undefined)"} === undefined`, `${of("maybeBox") ?? "(spare.next as Box | null)"} !== null`, `${of("maybeDouble") ?? "(spare.ratio as number | null)"} === null`,
        `${of("word") ?? "(words[0] as Word)"} === "${random.pick(["red", "green", "blue", ""])}"`, `${of("uint") ?? a} > 2147483647`, `${of("wide") ?? a} > ${b}`, `${of("maybeFlag") ?? `(${a} > 1)`} === true`, `${of("number") ?? a} >= ${of("double") ?? b}`, `${of("box") ?? "spare"} === ${of("box") ?? "spare"}`,
        `(${a} & ${random.pick(["1", "8", "255", "65536", "-2147483648"])}) ${random.pick(["===", "!=="])} 0`, `(${a} & ${b}) === 0`, `!(${a} & 4)`, `(${a} + ${b}) | 0`, `(${of("wide") ?? a} | 0) ${random.pick(["<", "===", ">="])} ${b}`, `(${of("wide") ?? a} | 0) === (${of("wide") ?? b} | 0)`,
        `(${of("wide") ?? a} & 255) === ${below(4)}`, `${of("uint") ?? a} ${random.pick(["<", ">", "<=", "==="])} ${of("uint") ?? b}`, `${of("wide") ?? a} ${random.pick(["<", ">", "===", "!=="])} ${random.pick(edgesOfWide)}`, `${of("wide") ?? a} ${random.pick(["<", ">=", "==="])} ${of("wide") ?? b}`,
        `${a} ${random.pick(["<", ">", "===", "<="])} ${random.pick(edgesOfInt)}`, `${of("double") ?? a} ${random.pick(["<", ">", "<=", ">=", "===", "!=="])} ${of("double") ?? b}`, `!(${of("double") ?? a} < ${of("double") ?? b})`, `${of("uint") ?? a} > ${a}`, `(${a} >>> 0) > (${b} >>> 0)`, `${of("double") ?? a}`, `${of("wide") ?? a}`,
        `${of("double") ?? a} * 0.5 + ${a} > ${of("wide") ?? b} / 3 - ${of("uint") ?? b}`, `(((${a} ^ ${b}) + (${int()} & ${a})) | 0) > ((${b} - ${int()}) | 0)`, `${of("double") ?? a} + ${of("double") ?? b} < ${of("double") ?? a} * ${of("double") ?? b}`,
        `Math.imul(${a}, ${b}) + ${of("wide") ?? a} > ${of("uint") ?? b} * 3`, `(${of("maybeDouble") ?? a} ?? ${of("double") ?? b}) + ${a} > (${of("maybeInt") ?? b} ?? ${int()})`, `${of("wide") ?? a} + ${a} > ${of("wide") ?? b} - ${b} && ${of("double") ?? a} - ${b} < ${of("double") ?? b} + ${a}`,
        of("text") ?? `${a} & 16`, `${of("text") ?? "spare.name"} === ${of("text") ?? "spare.name"}`, `(${drawn("memory")?.name ?? "odd"}[${a} & 7] | 0) > ${b}`]);
    };
    // The same variables, of one type, moved round by one place; or each given what any of them held before.
    const sameType = (most: number) => {
      const one = variables[below(count)];
      return random.sample(variables.filter(each => each.type === one.type && each.kind === one.kind), most); // prettier-ignore
    };
    const rotation = () => {
      const ring = sameType(random.pick([2, 3, 4, 6, 9, 16, 26, 40]));
      if (ring.length < 2) return assign();
      if (ring.length <= 4 && !below(3)) return `[${ring.map(each => each.name).join(", ")}] = [${[...ring.slice(1), ring[0]].map(each => each.name).join(", ")}];`;
      const kept = "k" + names++;
      return `const ${kept}: ${ring[0].type} = ${ring[0].name};${ring.map((each, index) => `${each.name} = ${index + 1 < ring.length ? ring[index + 1].name : kept};`).join("")}`;
    };
    const permutation = () => {
      const all = sameType(random.pick([3, 5, 8, 14, 26, 40]));
      if (all.length < 2) return assign();
      const first = names;
      names += all.length;
      return `const ${all.map((each, index) => `k${first + index}: ${each.type} = ${each.name}`).join(", ")};${random.shuffled(all).map(each => `${each.name} = k${first + below(all.length)};`).join("")}`;
    };
    const arm = (chosen: Variable[]) => random.shuffled(chosen).map(each => (below(3) ? copy(each) : store(each))).join(""); // prettier-ignore
    const wait = (): string => {
      const [a, b, c] = [int(), int(), int()];
      // prettier-ignore
      const yields = [`yield ${a};`, `${a} = ((yield ${b}) + ${c}) | 0;`, `${a} = (${b} + (yield ${c}) + ${a} + (yield ${b})) | 0;`];
      // prettier-ignore
      const awaits = [`${a} = await later(${b});`, "await null;", `${a} = (${b} + (await ${c})) | 0;`, `${a} = (${b} + (await later(${c})) + Math.imul(${a}, await later(${b}))) | 0;`, `[${a}, ${b === a ? "sink" : b}] = await Promise.all([later(${a}), later(${c})]);`,
        ...(guards || !below(6) ? [`${a} = await laterOrNever(${b});`, `${a} = await laterOrNever(${b});`] : [])];
      if (form === "generator") return random.pick([...yields, `${a} = (${b} + (yield* some(${c} & 3))) | 0;`]);
      if (form === "async") return random.pick([...awaits, `for await (const each of someLater(${c} & 3)) ${a} = (${a} + each) | 0;`]);
      if (form === "asyncGenerator") return random.pick([...yields, ...awaits, `${a} = (${b} + (yield* someLater(${c} & 3))) | 0;`]);
      return assign();
    };
    const called = (callee: string, takes: Kind[], first: string, second: string) => {
      const call = `${callee}(${[first, second, ...takes.map(argument)].join(", ")})`;
      return callee !== name || form === "plain" ? call : form === "async" ? `(await ${call})` : `(yield* ${call})`;
    };

    // `turns`: how often the place runs in one call at most. Loops in loops multiply.
    const statements = (left: number, loops: string[], turns: number): string => {
      let all = "";
      for (let more = 1 + below(4); more-- && budget > 0; ) {
        budget--;
        const inner = () => statements(left - 1, loops, turns);
        const guarded = () => {
          guards++;
          const block = inner();
          guards--;
          return block;
        };
        const kind = left > 0 ? below(44) : below(4);
        switch ([6, 7, 12, 14, 24, 38].includes(kind) && turns > 40 ? 0 : kind) {
          case 0: case 1: case 2: case 3: all += assign(); break; // prettier-ignore
          case 4: case 5: all += `if (${condition()}) {${inner()}} else {${inner()}}`; break; // prettier-ignore
          case 6: {
            const [counter, label] = ["c" + names, "L" + names++];
            all += `${label}: for (let ${counter} = 0; ${counter} < ${1 + below(5)}; ${counter}++) {${statements(left - 1, [...loops, label], turns * 5)}}`;
            break;
          }
          case 7: {
            const [counter, label] = ["c" + names, "L" + names++];
            all += `let ${counter} = ${1 + below(4)}; ${label}: while (${counter}-- > 0) {${statements(left - 1, [...loops, label], turns * 4)} if (${condition()}) ${below(2) ? "break" : "continue"};}`;
            break;
          }
          case 8: all += `switch (${int()} & 3) { case 0: ${inner()} break; case 1: ${inner()} case 2: ${inner()} break; default: ${inner()} }`; break; // prettier-ignore
          case 9: all += `try {${guarded()} if (${condition()}) throw ${random.pick([int(), of("box") ?? int(), of("text") ?? int(), of("double") ?? int()])};${guarded()}} catch (thrown) {${int()} = (fold(thrown) + 1) | 0;${inner()}} finally {${inner()}}`; break; // prettier-ignore
          case 10: all += `try {${inner()}} finally {${inner()}}`; break; // prettier-ignore
          case 11: {
            const label = "L" + names++;
            all += `${label}: {${inner()} if (${condition()}) break ${label};${inner()}}`;
            break;
          }
          case 12: {
            const counter = "c" + names++;
            all += `let ${counter} = ${1 + below(3)}; do {${statements(left - 1, loops, turns * 3)}} while (--${counter} > 0 && (${condition()}));`;
            break;
          }
          case 13: all += loops.length ? `if (${condition()}) ${below(2) ? "break" : "continue"} ${random.pick(loops)};` : assign(); break; // prettier-ignore
          case 14: all += `for (const each of [${int()}, ${int()}, ${below(9)}]) {${int()} = (${int()} + each) | 0;${statements(left - 1, loops, turns * 3)}}`; break; // prettier-ignore
          case 15: all += !below(4) ? `if (${condition()} && ${condition()}) return ${int()};` : assign(); break; // prettier-ignore
          case 16: all += `${int()} = ${condition()} ? ${value("int")} : ${value("int")};`; break; // prettier-ignore
          case 17: all += `try {${guarded()}} catch (thrown) {note(thrown);${inner()}}`; break; // prettier-ignore
          case 18: case 19: all += rotation(); break; // prettier-ignore
          case 20: all += permutation(); break; // prettier-ignore
          case 21: case 22: {
            const chosen = random.sample(variables, random.pick([6, 12, 24, 32, 64]));
            all += below(3) ? `if (${condition()}) {${arm(chosen)}} else {${arm(chosen)}}` : `switch (${int()} & 3) { case 0: ${arm(chosen)} break; case 1: ${arm(chosen)} break; case 2: ${arm(chosen)} ${below(2) ? "break;" : ""} default: ${arm(chosen)} }`;
            break;
          } // prettier-ignore
          case 23: all += `note(${read(variables[below(count)])});`; break; // prettier-ignore
          case 24: {
            const counter = "c" + names++;
            all += `for (let ${counter} = 0; ${counter} < ${2 + below(4)}; ${counter}++) {${rotation()}${below(2) ? `${int()} = opaqueInt(${int()}, ${counter});` : ""}${below(2) ? `if (${condition()}) {${below(2) ? rotation() : permutation()}}` : permutation()}${below(3) ? "" : wait()}}`;
            break;
          }
          case 38: {
            const counter = "c" + names++;
            const ring = sameType(random.pick([2, 3, 5, 9, 17]));
            const step = ring.length < 2 ? "" : ring.slice(1).map((each, index) => `, ${ring[index].name} = ${each.name}`).join("");
            all += `for (let ${counter} = 0; ${counter} < ${2 + below(3)} && (${condition()} || ${counter} < 1); ${counter}++${step}) {${below(2) ? assign() : rotation()}${below(2) ? `${int()} = opaqueInt(${int()}, ${counter});` : ""}${below(3) ? "" : wait()}}`;
            break;
          }
          case 39: case 40: {
            // One to three cases, the first body right behind the switch; the default is missing, shares a body with a case, or is the way back to the head of a loop.
            const labels = random.sample(["0", "1", "2", "3", "5", "6", "7", "-1", "128"], random.between(1, 3));
            const shared = below(3) ? -1 : below(labels.length);
            const small = `switch (${random.pick([`${int()} & 7`, `${int()} & 3`, `${int()} as number`, `(${condition()} ? ${value("int")} : 128) & 7`])}) {${labels.map((each, index) => `case ${each}: ${index === shared ? "default: " : ""}${below(2) ? assign() : arm(random.sample(variables, random.pick([2, 5, 12])))} ${below(4) ? "break;" : ""}`).join("")}}`;
            const counter = "c" + names++;
            all += below(2) || turns > 40 ? small : `for (let ${counter} = 0; ${counter} < ${2 + below(3)}; ${counter}++) {${assign()}${below(2) ? rotation() : ""}${small}}`;
            break;
          }
          case 25: {
            const [cases, chosen] = [random.pick([8, 16]), int()];
            all += `switch (${chosen} & ${cases - 1}) {${Array.from({ length: cases - below(3) }, (_, index) => `case ${index}: ${below(3) ? assign() : inner()} ${below(4) ? "break;" : ""}`).join("")} default: ${assign()} }`;
            break;
          }
          case 26: all += `switch (${of("word") ?? `words[${int()} & 3]`}) { case "red": ${inner()} break; case "green": ${inner()} case "blue": ${assign()} break; default: ${inner()} }`; break; // prettier-ignore
          case 27: {
            const [o, mo] = [drawn("box"), drawn("maybeBox")];
            all += o && mo ? `${mo.name} = ${o.name}.next;${o.name}.next = null;${int()} = scribble(${int()} & 7, 1);` : assign();
            break;
          }
          case 28:
            if (turns === 1 && !callsItself && !below(2)) {
              callsItself = true;
              all += `if ((a & 3) === 1) ${int()} = ${called(name, parameters.map(each => each.kind), "a >> 2", "b")};`; // prettier-ignore
            } else if (turns === 1 && callsEarlier < 3 && earlier.length) {
              callsEarlier++;
              const callee = random.pick(earlier);
              all += `${int()} = ${called(callee.name, callee.takes, `${int()} & 63`, `${int()} & 63`)};`;
            } else all += assign();
            break;
          case 29: all += `try {${guarded()} ${int()} = mayThrow(${int()});${guarded()}} catch (thrown) {${arm(random.sample(variables, random.pick([3, 8, 24])))}${int()} = fold(thrown);}`; break; // prettier-ignore
          case 30: all += loops.length ? `try {${inner()} if (${condition()}) ${random.pick(["break", "continue"])} ${random.pick(loops)};${inner()}} finally {${inner()}}` : `try {${inner()} if (${condition()} && ${condition()}) return ${int()};${inner()}} finally {${inner()}}`; break; // prettier-ignore
          case 31: {
            // The same test again where its answer is known, or would be, had nothing been assigned between.
            const test = condition();
            all += `if (${test}) {${below(2) ? assign() : ""}if (${test}) {${inner()}} else {${inner()}}} else {${below(2) ? assign() : ""}if (${below(2) ? test : `!(${test})`}) {${inner()}} else {${assign()}}}`;
            break;
          }
          case 32: {
            // A read, a write through a reference that may be the same object, the read again.
            const [o, p] = [of("box") ?? "spare", of("box") ?? "spare"];
            const [field, kind] = random.pick(fields.slice(0, 4));
            const [m, n] = [drawn("memory"), drawn("memory")];
            const [seen, again] = kind === "int" || !drawn(kind) ? [int(), int()] : [drawn(kind)!.name, drawn(kind)!.name];
            const narrowed = kind === "int" || !drawn(kind) ? " | 0" : "";
            if (m && n && m.type === n.type && below(2)) all += `${int()} = ${m.name}[${below(8)}] | 0;${n.name}[${int()} & 7] = ${value("int")};${int()} = (${m.name}[${below(8)}] + ${m.name}[${int()} & 7]) | 0;`;
            else all += `${seen} = ${o}.${field}${narrowed};${p}.${field} = ${value(kind)};${below(2) ? `${int()} = opaqueInt(${int()}, 1);` : ""}${again} = ${o}.${field}${narrowed};`;
            break;
          }
          case 33: {
            // Cases that share a target.
            const values = random.sample(Array.from({ length: 72 }, (_, index) => index - 4), random.pick([6, 12, 20]));
            const targets = random.between(2, 4);
            const subject = random.pick([`${int()} & 63`, `(${int()} & 127) - 8`, `${int()} as number`, `${of("number") ?? int()} as number`, `${of("any") ?? int()} as any`, `${of("uint") ?? int()} as number`]);
            all += `switch (${subject}) {${Array.from({ length: targets }, (_, target) => `${values.filter((_, index) => index % targets === target).map(each => `case ${each}:`).join(" ")} ${below(3) ? assign() : inner()} ${below(5) ? "break;" : ""}`).join("")}${below(2) ? ` default: ${assign()}` : ""}}`;
            break;
          }
          case 34: all += !below(3) ? `if (${condition()} && ${condition()}) return ${random.pick([`opaqueInt(${int()}, ${int()})`, `scribble(${int()} & 7, 1)`, ...mixes.filter(each => each.gives === "int").map(each => `${each.name}(${each.takes.map(argument).join(", ")})`)])};` : assign(); break; // prettier-ignore
          default: all += wait(); // prettier-ignore
        }
      }
      return all;
    };

    const contents = "[a, b, -a, 7, a ^ b, 300 - b, -1, b * 1000]";
    // prettier-ignore
    const first: Record<Kind, (index: number, type: string) => string> = {
      int: index => `(a * ${index + 1} + b * ${below(9)} + ${below(50)}) | 0`, uint: index => `(a * ${index + 1} - b) >>> 0`, wide: index => `a * ${random.pick(["4294967296", "1099511627776", "65536", "-8589934592"])} + b + ${index}`, double: index => `a * ${index}.5 + b / 4`,
      number: index => random.pick([`a + ${index}`, `a * 0.5`, `a * 4294967296`]), flag: index => `((a + ${index}) & 1) === 0`, text: index => `String((a + ${index}) & 31)`, word: index => `words[(a + ${index}) & 3]`, box: index => `new Box(b + ${index}, null)`, shape: index => `shapeOf(a + ${index}, new Box(b, null))`, boxes: index => `[new Box(a, null), new Box(b, null), new Box(${index}, null), new Box(a + b, null)]`, table: index => `new Map([[a & 7, b], [${index & 7}, a * 0.5]])`,
      memory: (_, type) => (type === "number[]" ? contents : `new ${type}(${contents})`), maybeInt: index => `(a + ${index}) & 1 ? a : undefined`, maybeDouble: index => `(a + ${index}) & 1 ? a * 0.5 : null`, maybeFlag: index => `(a + ${index}) & 1 ? a > b : undefined`,
      maybeText: index => `(a + ${index}) & 1 ? String(b) : undefined`, maybeBox: index => `(a + ${index}) & 1 ? new Box(a, null) : null`, any: index => random.pick([`a + ${index}`, `String(b)`, "undefined", `new Box(a, null)`, `a * 0.5`, "null"]),
    };
    // Ways out before the function needs anything.
    let body = random.pick(["", "", "if ((a & 15) === 3) return b;", "if (b > 60) return (a + b) | 0;", "if (a === 7) return opaqueInt(a, b);if (a === 9) return a;"]);
    body += "const spare = new Box(a, null);const round: Shape = new Disc(b, a * 0.5);const row: Box[] = [spare, spare, spare, spare];const counts = new Map<number, number>([[1, a]]);let sunk = false;";
    variables.forEach((each, index) => parameters.includes(each) || (body += `let ${each.name}: ${each.type} = ${first[each.kind](index, each.type)};`));
    for (let made = below(3); made--; ) {
      const [closure, written] = ["closure" + closures.length, int()];
      body += `const ${closure} = (x: number): number => { ${written} = (${written} + x) | 0; return ${written} ^ ${int()}; };`;
      closures.push(closure);
    }
    body += statements(depth, [], 1);
    body += `return (${variables.map(each => (each.kind === "int" ? each.name : `fold(${each.name})`)).join(" ^ ")}) | 0;`;
    const rounds = random.pick(form === "plain" ? [20, 100, 400] : [21, 99]);
    notes.push(`${form === "plain" ? "" : form + " "}${count} (${parameters.length}) of ${[...new Set(variables.map(each => each.kind))].join("+")}`);
    const head = { plain: "function", generator: "function*", async: "async function", asyncGenerator: "async function*" }[form];
    const result = { plain: "number", generator: "Generator<number, number, number>", async: "Promise<number>", asyncGenerator: "AsyncGenerator<number, number, number>" }[form];
    const call = (a: string) => `(a => ${name}(${["a", "b", ...parameters.map(each => first[each.kind](variables.indexOf(each), each.type))].join(", ")}))(${a})`;
    const stop = "i % 5 ? -1 : (i >> 2) & 15";
    const answer = {
      plain: `try {\n      hash = (Math.imul(hash, 31) + ${call("i")}) | 0;\n    } catch (thrown) {\n      hash = (hash ^ fold(thrown)) | 0;\n    }`,
      generator: `hash = (Math.imul(hash, 31) + drained(${call("i")}, ${stop})) | 0;`,
      async: `for (const each of await Promise.allSettled([${call("i")}, ${call("i + 1")}, ${call("i + 2")}])) hash = (Math.imul(hash, 31) + settled(each)) | 0;`,
      asyncGenerator: `hash = (Math.imul(hash, 31) + (await drainedLater(${call("i")}, ${stop}))) | 0;`,
    }[form];
    text.push(`${head} ${name}(${["a: number", "b: number", ...parameters.map(each => `${each.name}: ${each.type}`)].join(", ")}): ${result} {\n${body.replace(/([;{}])(?=[^\n])/g, "$1\n")}\n}
{
  let hash = 0;
  for (let i = 0; i < ${rounds}; i += ${form === "async" ? 3 : 1}) {
    const b = (i * 7) & 63;
    sink ^= scribble(i & 15, 2);
    ${answer}
  }
  console.log("${name} " + (hash >>> 0).toString(16));
  console.log("${name} on the way " + (sink >>> 0).toString(16));
}
`);
    if (form === "plain") earlier.push({ name, takes: parameters.map(each => each.kind) });
  }
  return `// ${notes.join(" . ")}\n${text.join("\n")}`;
}

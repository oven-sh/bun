// A thing whose parts lie outside of it, read on every turn of a loop by the only one that still holds it, while the same turn makes other things.
// Nothing needs the thing but the reads of the loop. It stays whole up to the last of them, however much is made in between.
//
//   thing    an object, an instance or a record with a few or very many optional flags, whole numbers, fractions, texts, objects and members of two kinds; lists of numbers, fractions, texts, objects and lists,
//            written out, grown or filled; lists of bytes, of integers and of fractions, short and long, and views of a part of one; a DataView, a Buffer; texts put together, cut out, wide, long;
//            Maps, Sets, closures, bound functions, generators, instances with private fields, instances of classes below Map, Array and Error, big whole numbers, dates, patterns, chains, objects that hold a list
//   held     as an argument, as `this`, by a default, out of a pattern or a rest list, in a variable of the function; taken out of a list, an object, a Map or a variable of a closure that lets go of it at once;
//            given up for another in the middle of the loop
//   loop     counted up or down, `while`, `do`, for-of, a loop in a loop with the reads inside or outside, with `continue`, with a handler around what is made, in a generator, in an async function
//   made     texts, objects, lists, closures, instances, Maps, big whole numbers, errors that are thrown and caught: by a function that calls itself, by a built-in or right there; ahead of the reads, between them, behind them
//   read     members by name, by `in`, by Object.hasOwn; elements by the turn and by a constant; lengths, sizes, searches, comparisons, calls
//   stored   in some programs the turn also stores: a flag, a number, a new text, a new object, an element
//   later    in some programs the thing is read once more behind the loop
import type { Random } from "./random";

type Thing = {
  type: string;
  /** What stands at the top of the program for it; the same text stands there once. */
  declarations: string[];
  /** The body of `function make(i: number): type`. */
  make: string;
  /** How far apart the arguments of make() lie, and the first of them. */
  step: number;
  first: number;
  /** Expressions that give a number. */
  reads: ((it: string, turn: string) => string)[];
  /** The same, one list a part of the thing, the plainest read first: a turn reads several parts rather than one part in several ways. */
  readsOfParts?: ((it: string, turn: string) => string)[][];
  /** Statements. */
  stores: ((it: string, turn: string) => string)[];
  /** What else the program does with such things; it stands behind make(). */
  elsewhere?: string;
};

const prelude = `type Link = { next: Link | null; n: number };
function link(n: number, depth: number): Link {
  return depth > 0 ? { next: link(n + 1, depth - 1), n } : { next: null, n };
}
function label(n: number, depth: number): string {
  return depth > 0 ? label(n + 1, depth - 1) + "." : "t" + n;
}
function fractions(n: number, depth: number): number[] {
  return depth > 0 ? [n + 0.5, ...fractions(n + 1, depth - 1)] : [n + 0.25];
}
function counter(n: number): () => number {
  let count = n;
  return () => count++;
}
function refuses(n: number): number {
  if (n % 3 !== 1) throw new RangeError("no " + n);
  return n;
}
function sizeOf(value: number | string | undefined): number {
  return typeof value === "string" ? value.length : (value ?? 0);
}
class Small {
  constructor(
    public n: number,
    public t: string,
  ) {}
}
const mix = (sum: number, more: number): number => (Math.imul(sum, 31) + more) | 0;`;

const padded = (n: number) => String(n).padStart(3, "0");

/** The kinds of members of a wide object: the letter its names begin with, its type, a value out of `i` and its number, reads and stores. */
const members: Record<string, { type: string; value: (at: number) => string; reads: ((place: string, name: string, it: string) => string)[]; stores: ((place: string, turn: string) => string)[] }> = {
  b: {
    type: "boolean",
    value: at => (at % 3 ? "true" : "false"),
    reads: [place => `(${place} ? 1 : 0)`, place => `(${place} === undefined ? 2 : 0)`, place => `(${place} === false ? 4 : 1)`, (_, name, it) => `("${name}" in ${it} ? 1 : 0)`],
    stores: [(place, turn) => `${place} = (${turn} & 1) === 0;`, place => `${place} = !${place};`],
  },
  n: {
    type: "number",
    value: at => `i + ${at}`,
    reads: [place => `(${place} ?? 0)`, place => `(${place} === undefined ? 1 : ${place} | 0)`, (_, name, it) => `(Object.hasOwn(${it}, "${name}") ? 1 : 0)`],
    stores: [(place, turn) => `${place} = ${turn} + 1;`, place => `${place} = (${place} ?? 0) + 3;`],
  },
  d: {
    type: "number",
    value: at => `i / 4 + ${at}.5`,
    reads: [place => `Math.floor((${place} ?? 0) * 4)`, place => `(${place} !== undefined && ${place} > 2.5 ? 1 : 0)`],
    stores: [(place, turn) => `${place} = ${turn} / 8;`, place => `${place} = (${place} ?? 0) * 1.5;`],
  },
  s: {
    type: "string",
    value: at => `"s" + (i + ${at})`,
    reads: [place => `(${place}?.length ?? 0)`, place => `((${place} ?? "none").charCodeAt(1) | 0)`, place => `(${place} === "s7" ? 1 : 0)`],
    stores: [(place, turn) => `${place} = label(${turn}, 1);`, (place, turn) => `${place} = (${place} ?? "") + ${turn};`],
  },
  p: {
    type: "Link",
    value: at => `{ next: null, n: i + ${at} }`,
    reads: [place => `(${place}?.n ?? 0)`, place => `(${place} ? 1 : 0)`, place => `(${place}?.next?.n ?? 3)`],
    stores: [(place, turn) => `${place} = link(${turn}, 1);`, (place, turn) => `if (${place}) ${place}.n += ${turn};`],
  },
  u: {
    type: "number | string",
    value: at => (at & 1 ? `"u" + (i + ${at})` : `i * 2 + ${at}`),
    reads: [place => `(typeof ${place} === "string" ? ${place}.length : (${place} ?? 0))`, place => `(typeof ${place} === "number" ? 1 : 0)`],
    stores: [(place, turn) => `${place} = ${turn} & 1 ? "v" + ${turn} : ${turn};`],
  },
  f: {
    type: "boolean | null",
    value: at => ["true", "false", "null"][at % 3],
    reads: [place => `(${place} === null ? 3 : ${place} ? 1 : 0)`, place => `(${place} ?? true ? 1 : 0)`],
    stores: [(place, turn) => `${place} = ${turn} % 3 ? null : true;`],
  },
};

/** An object with a few or very many optional members, most of which are not set in any one object. */
function wide(random: Random, index: number): Thing {
  const name = `Wide${index}`;
  // Half of them have very many flags, far more than find room in the object, and little else.
  const manyFlags = random.chance(0.5);
  const letters = manyFlags ? random.pick([["b"], ["b"], ["f"], ["b", "f"], ["b", random.pick(["n", "d", "s", "p", "u"])]]) : random.chance(0.4) ? [random.pick(Object.keys(members))] : random.sample(Object.keys(members), random.between(2, 5));
  const counts = new Map(letters.map(letter => [letter, letter === "b" || letter === "f" ? random.pick(manyFlags ? [90, 120, 160, 160, 220] : [3, 12, 40, 90, 160]) : random.pick(manyFlags ? [2, 6] : [2, 6, 20, 40, 90])]));
  const all = letters.flatMap(letter => Array.from({ length: counts.get(letter)! }, (_, at) => letter + padded(at)));
  const listed = random.chance(0.3) ? random.shuffled(all) : all;
  const fields = listed.map(member => `${member}?: ${members[member[0]].type};`).join(" ");
  const form = random.pick(["interface", "type", "class", "class with a parent"]);
  const declaration =
    form === "interface"
      ? `interface ${name} { name: string; ${fields} }`
      : form === "type"
        ? `type ${name} = { name: string; ${fields} };`
        : form === "class"
          ? `class ${name} { ${fields} constructor(public name: string) {} }`
          : `class Below${index} { constructor(public name: string) {} }\nclass ${name} extends Below${index} { ${fields} }`;
  const born = form.startsWith("class") ? `new ${name}("n" + i)` : `{ name: "n" + i }`;
  const groups = random.pick([1, 4, 16]);
  const group = random.below(groups);
  const ofGroup = (which: number) => all.filter(member => Number(member.slice(1)) % groups === which);
  const set = (member: string) => `next.${member} = ${members[member[0]].value(Number(member.slice(1)))};`;
  let make: string;
  if (!form.startsWith("class") && random.chance(0.25)) make = `  return { name: "n" + i, ${ofGroup(group).map(member => `${member}: ${members[member[0]].value(Number(member.slice(1)))}`).join(", ")} };`;
  else if (groups === 1) make = `  const next: ${name} = ${born};\n  ${all.map(set).join(" ")}\n  return next;`;
  else make = `  const next: ${name} = ${born};\n  switch (i % ${groups}) {\n${Array.from({ length: groups }, (_, which) => `    case ${which}: ${ofGroup(which).map(set).join(" ")} break;`).join("\n")}\n  }\n  return next;`;
  // Mostly the last members of a kind that the objects of the scene have; now and then one that they lack.
  const mine = ofGroup(group);
  const chosen = letters.flatMap(letter => mine.filter(member => member[0] === letter).slice(-random.pick([2, 4, 4, 6])));
  if (!chosen.length || random.chance(0.5)) chosen.push(random.pick(all));
  if (random.chance(0.5)) chosen.push(random.pick(mine.length ? mine : all));
  const readsOfParts = [...new Set(chosen)].map(member => members[member[0]].reads.map(read => (it: string) => read(`${it}.${member}`, member, it)));
  const reads = readsOfParts.flat();
  const stores = chosen.flatMap(member => members[member[0]].stores.map(store => (it: string, turn: string) => store(`${it}.${member}`, turn)));
  // Where a member lies may go by how much the whole program reads it. In most programs other functions read the first members of each kind very often and the rest once, on objects of their own.
  let elsewhere: string | undefined;
  if (manyFlags || random.chance(0.8)) {
    const share = random.pick([0.2, 0.4, 0.4, 0.7]);
    const first = all.filter(member => !chosen.includes(member) && Number(member.slice(1)) < counts.get(member[0])! * share);
    const rest = all.filter(member => !first.includes(member) && (!chosen.includes(member) || random.chance(0.7)));
    const read = (member: string) => `n = mix(n, ${members[member[0]].reads[0](`o.${member}`, member, "o")});`;
    elsewhere = `function often${index}(o: ${name}, turns: number): number {
  let n = 0;
  for (let a = 0; a < turns; a++) for (let b = 0; b < turns; b++) for (let c = 0; c < turns; c++) { ${first.map(read).join(" ")} }
  return n;
}
function once${index}(o: ${name}): number {
  let n = 0;
  ${rest.map(read).join(" ")}
  return n;
}
{
  let sum = 0;
  for (let i = 0; i < ${random.pick([1, 3, groups])}; i++) sum = mix(sum, often${index}(make${index}(i), 2) + once${index}(make${index}(i)));
  console.log("${index} elsewhere:", sum);
}`;
  }
  return { type: name, declarations: [declaration], make, step: groups, first: group, reads, readsOfParts, stores, elsewhere };
}

const plain = (type: string, make: string, reads: Thing["reads"], stores: Thing["stores"] = [], declarations: string[] = []): Thing => ({ type, declarations, make: "  " + make, step: 1, first: 0, reads, stores });

function list(random: Random): Thing {
  const size = random.pick([1, 3, 8, 40, 300, 1200]);
  const [type, value, read, fresh] = random.pick<[string, (at: string) => string, (place: string) => string, (turn: string) => string]>([
    ["number", at => `i + ${at}`, place => `(${place} ?? 0)`, turn => `${turn} + 1`],
    ["number", at => `i / 2 + ${at} + 0.25`, place => `Math.floor((${place} ?? 0) * 4)`, turn => `${turn} / 4`],
    ["string", at => `"e" + (i + ${at})`, place => `(${place}?.length ?? 0)`, turn => `label(${turn}, 1)`],
    ["Link", at => `{ next: null, n: i + ${at} }`, place => `(${place}?.n ?? 0)`, turn => `link(${turn}, 1)`],
    ["number[]", at => `[i, ${at}, i + ${at}]`, place => `(${place}?.[2] ?? 0)`, turn => `[${turn}, 1, 2]`],
    ["number | string", at => `(${at}) & 1 ? "m" + i : i + ${at}`, place => `sizeOf(${place})`, turn => `${turn}`],
  ]);
  const make = random.pick([
    `const o: ${type === "number | string" ? "(number | string)" : type}[] = []; for (let k = 0; k < ${size}; k++) o.push(${value("k")}); return o;`,
    `return Array.from({ length: ${size} }, (_, k) => ${type === "Link" ? `(${value("k")})` : value("k")});`,
    `return [${Array.from({ length: Math.min(size, 8) }, (_, at) => value(String(at))).join(", ")}];`,
    `const o = new Array<${type}>(${size}); for (let k = 0; k < ${size}; k++) o[k] = ${value("k")}; return o;`,
  ]);
  const at = random.below(Math.min(size, 8));
  return plain(
    `(${type})[]`,
    make,
    [(it, turn) => read(`${it}[${turn} % ${it}.length]`), it => read(`${it}[${at}]`), it => `${it}.length`, it => read(`${it}.at(-1)`), (it, turn) => read(`${it}[${turn}]`)],
    [(it, turn) => `${it}[${at}] = ${fresh(turn)};`, (it, turn) => `${it}.push(${fresh(turn)});`, it => `${it}.pop();`, (it, turn) => `${it}[${turn} % ${it}.length] = ${fresh(turn)};`],
  );
}

function numbersInARow(random: Random): Thing {
  const kind = random.pick(["Uint8Array", "Int8Array", "Uint16Array", "Int32Array", "Float32Array", "Float64Array", "Uint8ClampedArray"]);
  const size = random.pick([4, 16, 100, 1000, 5000]);
  const fill = `for (let k = 0; k < ${Math.min(size, 24)}; k++) o[k] = i + k;`;
  const make = random.pick([
    `const o = new ${kind}(${size}); ${fill} return o;`,
    `const o = new ${kind}(new ArrayBuffer(${size} * ${kind}.BYTES_PER_ELEMENT + 16), 8, ${size}); ${fill} return o;`,
    `const all = new ${kind}(${size} + 6); const o = all.subarray(3, ${size} + 3); ${fill} return o;`,
    `const o = ${kind}.from({ length: ${Math.min(size, 100)} }, (_, k) => i + k); return o;`,
  ]);
  return plain(
    kind,
    make,
    [(it, turn) => `Math.floor(${it}[${turn}] ?? 0)`, it => `Math.floor(${it}[3])`, it => `${it}.length`, it => `${it}.byteOffset`, (it, turn) => `Math.floor(${it}[${turn} % ${it}.length])`, it => `${it}.indexOf(5)`],
    [(it, turn) => `${it}[2] = ${turn};`, (it, turn) => `${it}[${turn} % ${it}.length] += 1;`],
  );
}

function text(random: Random): Thing {
  const make = random.pick([
    `return "a" + i + "-" + label(i, 6) + i;`,
    `return ("0123456789" + i).repeat(${random.pick([2, 30, 400])});`,
    `return ("left " + label(i, 9) + " right " + i).slice(3, -2);`,
    `return ("\\u4e00\\u00e9" + i + "\\ud83d\\ude00").repeat(${random.pick([2, 40])});`,
    `return [i, i + 1, "x", i + 2].join("|") + String.fromCharCode(65 + (i % 26));`,
    `return JSON.stringify({ i, t: label(i, 4) });`,
    `return (label(i, 12) + label(i + 1, 12)).substring(${random.between(1, 9)});`,
  ]);
  return plain("string", make, [
    (it, turn) => `(${it}.charCodeAt(${turn}) | 0)`,
    (it, turn) => `(${it}[${turn}] === "1" ? 1 : 0)`,
    it => `${it}.length`,
    it => `${it}.indexOf("7")`,
    (it, turn) => `(${it}.codePointAt(${turn}) ?? 0)`,
    it => `(${it} < "m" ? 1 : 0)`,
    it => `(${it}.at(-1) === "." ? 1 : 0)`,
    it => `(${it}.endsWith("2") ? 1 : 0)`,
    (it, turn) => `(${it} === "t" + ${turn} ? 1 : 0)`,
  ]);
}

const others: ((random: Random, index: number) => Thing)[] = [
  random =>
    plain(
      "DataView",
      `const o = new DataView(new ArrayBuffer(${random.pick([32, 2048])})); for (let k = 0; k < 14; k++) o.setInt16(k * 2, i * k); return o;`,
      [(it, turn) => `${it}.getInt16((${turn} % 12) * 2)`, (it, turn) => `${it}.getUint8((${turn} % 20) + 3)`, it => `${it}.byteLength`],
      [(it, turn) => `${it}.setInt8(5, ${turn});`],
    ),
  random =>
    plain(
      "Buffer",
      `const o = Buffer.${random.pick(["alloc", "allocUnsafe"])}(${random.pick([24, 3000, 9000])}); o.fill(1); for (let k = 0; k < 16; k++) o[k] = i + k; return o;`,
      [(it, turn) => `${it}.readUInt8(${turn} % 20)`, (it, turn) => `${it}.readInt16LE((${turn} % 16) + 2)`, (it, turn) => `${it}[(${turn} % 16) + 5]`, it => `${it}.length`],
      [(it, turn) => `${it}.writeUInt8(${turn} & 255, 7);`, (it, turn) => `${it}[3] = ${turn};`],
    ),
  random =>
    plain(
      "Map<string, Link>",
      `const o = new Map<string, Link>(); for (let k = 0; k < ${random.pick([2, 20, 200])}; k++) o.set("k" + k, { next: null, n: i + k }); return o;`,
      [it => `(${it}.get("k1")?.n ?? 0)`, it => `(${it}.has("k19") ? 1 : 0)`, it => `${it}.size`, (it, turn) => `(${it}.get("k" + ${turn})?.n ?? 0)`],
      [(it, turn) => `${it}.set("k1", link(${turn}, 1));`, (it, turn) => `${it}.set("more" + ${turn}, link(${turn}, 0));`, it => `${it}.delete("k0");`],
    ),
  random =>
    plain(
      "Map<number, string>",
      `const o = new Map<number, string>(); for (let k = 0; k < ${random.pick([2, 20, 200])}; k++) o.set(k, "v" + (i + k)); return o;`,
      [(it, turn) => `(${it}.get(${turn})?.length ?? 0)`, it => `${it}.size`, it => `(${it}.get(1) === "v4" ? 1 : 0)`],
      [(it, turn) => `${it}.set(${turn}, label(${turn}, 1));`],
    ),
  random =>
    plain(
      "Set<Link>",
      `const o = new Set<Link>(); for (let k = 0; k < ${random.pick([1, 12, 120])}; k++) o.add({ next: null, n: i + k }); return o;`,
      [it => `${it}.size`, it => `[...${it}][0].n`, it => `${it}.values().next().value!.n`],
      [(it, turn) => `${it}.add(link(${turn}, 0));`],
    ),
  () => plain("() => number", `const a: Link = { next: null, n: i }; const b = "t" + i; let c = i / 2; return () => a.n + b.length + Math.floor(c++);`, [it => `${it}()`]),
  () => plain("(more: number) => number", `const inner = counter(i); const kept = link(i, 2); return more => inner() + kept.next!.n + more;`, [(it, turn) => `${it}(${turn})`]),
  () => plain("(more: number) => number", `const kept = new Small(i, "b" + i); return function (this: Small, first: number, more: number) { return this.n + this.t.length + first + more; }.bind(kept, i);`, [(it, turn) => `${it}(${turn})`]),
  () => plain("Generator<number, number, unknown>", `return (function* (from: Link) { for (let k = 0; ; k++) yield from.n + from.next!.n + k; })(link(i, 1));`, [it => `(${it}.next().value | 0)`]),
  (_, index) =>
    plain(
      `Hidden${index}`,
      `return new Hidden${index}(i);`,
      [it => `${it}.total()`, it => `${it}.text.length`],
      [(it, turn) => `${it}.put(${turn});`],
      [`class Hidden${index} { #a: Link; #b: string; text: string; constructor(i: number) { this.#a = { next: null, n: i }; this.#b = "p" + i; this.text = "q" + i; } total(): number { return this.#a.n + this.#b.length; } put(n: number) { this.#a = link(n, 0); this.#b += n; } }`],
    ),
  (_, index) =>
    plain(
      `Bag${index}`,
      `const o = new Bag${index}(); o.extra = link(i, 1); o.note = "n" + i; for (let k = 0; k < 6; k++) o.set(k, i + k); return o;`,
      [it => `(${it}.extra?.next?.n ?? 0)`, it => `${it}.note.length`, it => `${it}.size`, (it, turn) => `(${it}.get(${turn}) ?? 0)`],
      [(it, turn) => `${it}.extra = link(${turn}, 1);`, (it, turn) => `${it}.set(${turn}, ${turn});`],
      [`class Bag${index} extends Map<number, number> { extra: Link | null = null; note = ""; }`],
    ),
  (_, index) =>
    plain(
      `Row${index}`,
      `const o = new Row${index}(); o.mark = link(i, 0); for (let k = 0; k < 9; k++) o.push(i + k); return o;`,
      [it => `(${it}.mark?.n ?? 0)`, it => `${it}.length`, (it, turn) => `(${it}[${turn}] ?? 0)`, it => `${it}[4]`],
      [(it, turn) => `${it}.mark = link(${turn}, 0);`, (it, turn) => `${it}.push(${turn});`],
      [`class Row${index} extends Array<number> { mark: Link | null = null; }`],
    ),
  (_, index) =>
    plain(
      `Failed${index}`,
      `return new Failed${index}("f" + i, link(i, 1));`,
      [it => `${it}.message.length`, it => `${it}.why.next!.n`, it => `(${it}.name === "Error" ? 1 : 0)`],
      [(it, turn) => `${it}.why = link(${turn}, 1);`],
      [`class Failed${index} extends Error { constructor(message: string, public why: Link) { super(message); } }`],
    ),
  random => plain("bigint", `return ${random.pick(["BigInt(i) * 1000000007n ** 3n", "(1n << 90n) + BigInt(i)", "BigInt(i + 3)"])};`, [it => `Number(${it} & 255n)`, it => `(${it} > 5n ? 1 : 0)`, (it, turn) => `Number((${it} >> BigInt(${turn})) & 7n)`]),
  () => plain("Date", `return new Date(86400000 * i + 1234);`, [it => `(${it}.getTime() % 1000)`, it => `${it}.getUTCDate()`], [(it, turn) => `${it}.setUTCHours(${turn} % 24);`]),
  () => plain("RegExp", `return new RegExp("[" + (i % 10) + "t](\\\\d+)", "g");`, [(it, turn) => `(${it}.exec("t" + ${turn} + "t12 34")?.[1].length ?? 0)`, it => `${it}.lastIndex`, it => `${it}.source.length`], [it => `${it}.lastIndex = 0;`]),
  random => plain("Link", `return link(i, ${random.pick([2, 5, 30])});`, [it => `${it}.next!.next!.n`, it => `${it}.n`, it => `(${it}.next!.next!.next === null ? 1 : 0)`], [(it, turn) => `${it}.next!.next = link(${turn}, 1);`, (it, turn) => `${it}.next!.n = ${turn};`]),
  random =>
    plain(
      "{ items: number[]; names: string[]; n: number }",
      `const o = { items: [] as number[], names: [] as string[], n: i }; for (let k = 0; k < ${random.pick([3, 30, 400])}; k++) { o.items.push(i + k${random.chance(0.5) ? " + 0.5" : ""}); o.names.push("n" + k); } return o;`,
      [(it, turn) => `Math.floor(${it}.items[${turn} % ${it}.items.length])`, it => `${it}.names[1].length`, it => `${it}.items.length`, it => `Math.floor(${it}.items[2])`, (it, turn) => `(${it}.names[${turn}]?.length ?? 0)`],
      [(it, turn) => `${it}.items[1] = ${turn};`, (it, turn) => `${it}.names[1] = label(${turn}, 1);`, (it, turn) => `${it}.items = fractions(${turn}, 3);`],
    ),
  () =>
    plain(
      "[number, string, Link, number[]]",
      `return [i, "p" + i, link(i, 1), [i, i + 1, i + 2]];`,
      [it => `${it}[0]`, it => `${it}[1].length`, it => `${it}[2].next!.n`, (it, turn) => `${it}[3][${turn} % 3]`],
      [(it, turn) => `${it}[2] = link(${turn}, 1);`, (it, turn) => `${it}[3] = [${turn}, 2, 3];`],
    ),
  random =>
    plain(
      "Record<string, Link>",
      `const o: Record<string, Link> = {}; for (let k = 0; k < ${random.pick([4, 30, 200])}; k++) o["k" + k] = { next: null, n: i + k }; return o;`,
      [it => `${it}.k3.n`, it => `${it}.k1.n`, (it, turn) => `(${it}["k" + ${turn}]?.n ?? 0)`],
      [(it, turn) => `${it}.k3 = link(${turn}, 0);`, (it, turn) => `${it}["more" + ${turn}] = link(${turn}, 0);`, it => `delete ${it}.k0;`],
    ),
  () =>
    plain(
      "{ a?: number; b?: string; c?: Link; d?: boolean; e?: number }",
      `const o: { a?: number; b?: string; c?: Link; d?: boolean; e?: number } = {}; if (i & 1) o.a = i; if (i & 2) o.b = "b" + i; o.c = link(i, 0); if (i & 4) o.d = true; o.e = i / 2; return o;`,
      [it => `(${it}.a ?? 0)`, it => `(${it}.b?.length ?? 0)`, it => `(${it}.c?.n ?? 0)`, it => `(${it}.d ? 1 : 0)`, it => `Math.floor((${it}.e ?? 0) * 2)`],
      [(it, turn) => `${it}.b = label(${turn}, 1);`, (it, turn) => `${it}.c = link(${turn}, 0);`, (it, turn) => `${it}.a = ${turn};`, it => `delete ${it}.e;`],
    ),
];

/** What a turn makes: an expression that gives a number. */
const made: ((turn: string) => string)[] = [
  turn => `label(${turn}, 3).length`,
  turn => `link(${turn}, 3).n`,
  turn => `fractions(${turn}, 2).length`,
  turn => `counter(${turn})()`,
  turn => `[${turn}, ${turn} + 0.5].length`,
  turn => `{ a: ${turn}, b: "x" + ${turn} }.b.length`,
  turn => `\`\${${turn}}:\${n}\`.length`,
  turn => `String(${turn} * 1.5).length`,
  turn => `JSON.stringify({ turn: ${turn} }).length`,
  turn => `new Array<number>(${turn} + 1).fill(${turn}).length`,
  turn => `new Uint8Array(${turn} + 8).length`,
  turn => `new Float64Array(${turn} + 300).length`,
  turn => `(() => ${turn} + n)()`,
  turn => `(BigInt(${turn}) * 3n > 5n ? 1 : 0)`,
  turn => `new Map([[${turn}, ${turn}]]).size`,
  turn => `new Small(${turn}, "s").n`,
  turn => `new Small(${turn}, "s" + ${turn}).t.length`,
  turn => `("a,b," + ${turn}).split(",").length`,
  turn => `Object.keys({ a: ${turn}, b: 1 }).length`,
  turn => `new Error("e" + ${turn}).message.length`,
  turn => `[...fractions(${turn}, 1), ${turn}].length`,
  turn => `Math.floor(Number.parseFloat(${turn} + ".5") * 2)`,
];

function scene(random: Random, index: number, declarations: Set<string>): string {
  const thing = random.weighted<(random: Random, index: number) => Thing>([[10, wide], [3, list], [2, numbersInARow], [2, text], [5, (random, index) => random.pick(others)(random, index)]])(random, index); // prettier-ignore
  for (const declaration of thing.declarations) declarations.add(declaration);
  const { type } = thing;
  const held = random.pick(["argument", "argument", "argument", "this", "default", "pattern", "rest", "variable", "variable", "out of a list", "popped", "out of an object", "out of a Map", "out of a closure", "given up for another"]);
  const shape = random.pick(["function", "function", "function", "function", "function", "arrow", "arrow", "generator", "async"]);
  const it = held === "this" && shape !== "arrow" ? "this" : "o";
  const turns = random.pick([2, 5, 8, 8, 20]);
  const rounds = random.pick([1, 3, 12, 30]);
  const turn = "turn";

  const drawn = thing.readsOfParts ? random.sample(thing.readsOfParts, random.pick([1, 2, 3, 4, 4, 6])).map(ways => (random.chance(0.7) ? ways[0] : random.pick(ways))) : random.sample(thing.reads, random.between(1, 4));
  const reads = drawn.map(read => `n = mix(n, ${read(it, turn)});`);
  const stores = thing.stores.length && random.chance(0.35) ? random.sample(thing.stores, random.between(1, 2)).map(store => store(it, turn)) : [];
  const makes = Array.from({ length: random.pick([1, 1, 1, 2, 3]) }, () => {
    const expression = random.pick(made)(turn);
    const text = expression.startsWith("{") ? `(${expression})` : expression;
    if (random.chance(0.12)) return `try { n = mix(n, refuses(${turn}) + ${text}); } catch (error) { n = mix(n, (error as Error).message.length); }`;
    if (shape === "async" && random.chance(0.4)) return `n = mix(n, await Promise.resolve(${text}));`;
    return `n = mix(n, ${text});`;
  });
  // What is made stands ahead of the reads, between them or behind them; a store stands anywhere.
  let body = [...reads];
  for (const line of [...makes, ...stores]) body.splice(random.below(body.length + 1), 0, line);
  if (held === "given up for another") body.push(`if (${turn} === ${random.below(turns)}) o = make${index}(i + ${thing.step} * (${turn} + 1));`);
  if (random.chance(0.15)) body.splice(random.between(1, body.length), 0, `if ((${turn} & 3) === 2) continue;`);
  if (shape === "generator") body.push("yield n;");

  const inner = body.map(line => "    " + line).join("\n");
  const loop = random.pick([
    `  for (let turn = 0; turn < turns; turn++) {\n${inner}\n  }`,
    `  for (let turn = 0; turn < turns; turn++) {\n${inner}\n  }`,
    `  for (let turn = turns - 1; turn >= 0; turn--) {\n${inner}\n  }`,
    `  let before = 0;\n  while (before < turns) {\n    const turn = before++;\n${inner}\n  }`,
    `  let before = 0;\n  do {\n    const turn = before++;\n${inner}\n  } while (before < turns);`,
    `  for (const turn of [${Array.from({ length: turns }, (_, at) => at).join(", ")}]) {\n${inner}\n  }`,
    `  for (let outer = 0; outer < 2; outer++)\n  for (let turn = outer; turn < turns; turn += 2) {\n${inner}\n  }`,
    `  for (let turn = 0; turn < turns; turn++) {\n    for (let again = 0; again < 3; again++) {\n      ${reads.join(" ")}\n    }\n${inner}\n  }`,
  ]);
  const later = random.chance(0.2) ? `  n = mix(n, ${random.pick(thing.reads)(it, "1")});\n` : "";

  const take: Record<string, [parameters: string, first: string, call: (made: string) => string]> = {
    "argument": [`o: ${type}, turns: number`, "", made => `(${made}, ${turns})`],
    "this": shape === "arrow" ? [`o: ${type}, turns: number`, "", made => `(${made}, ${turns})`] : [`this: ${type}, turns: number`, "", made => `.call(${made}, ${turns})`],
    "default": [`i: number, turns: number, o: ${type} = make${index}(i)`, "", () => `(at, ${turns})`],
    "pattern": [`{ it: o }: { it: ${type} }, turns: number`, "", made => `({ it: ${made} }, ${turns})`],
    "rest": [`turns: number, ...all: (${type})[]`, `  const o = all[0];\n  all.length = 0;\n`, made => `(${turns}, ${made})`],
    "variable": [`i: number, turns: number`, `  const o = make${index}(i);\n`, () => `(at, ${turns})`],
    "out of a list": [`i: number, turns: number`, `  const all: (${type})[] = [make${index}(i), make${index}(i + ${thing.step})];\n  const o = all[0];\n  all[0] = all[1];\n`, () => `(at, ${turns})`],
    "popped": [`i: number, turns: number`, `  const all: (${type})[] = [make${index}(i + ${thing.step}), make${index}(i)];\n  const o = all.pop()!;\n`, () => `(at, ${turns})`],
    "out of an object": [`i: number, turns: number`, `  const holder: { it: (${type}) | null } = { it: make${index}(i) };\n  const o = holder.it!;\n  holder.it = null;\n`, () => `(at, ${turns})`],
    "out of a Map": [`i: number, turns: number`, `  const all = new Map<number, ${type}>([[i, make${index}(i)]]);\n  const o = all.get(i)!;\n  all.${random.pick(["delete(i)", "clear()"])};\n`, () => `(at, ${turns})`],
    "out of a closure": [`i: number, turns: number`, `  let kept: (${type}) | null = make${index}(i);\n  const give = () => {\n    const given = kept!;\n    kept = null;\n    return given;\n  };\n  const o = give();\n`, () => `(at, ${turns})`],
    "given up for another": [`i: number, turns: number`, `  let o = make${index}(i);\n`, () => `(at, ${turns})`],
  };
  const [parameters, first, call] = take[held];
  const block = `{\n${first}  let n = 0;\n${loop}\n${later}  return n;\n}`;
  const result = shape === "async" ? "Promise<number>" : shape === "generator" ? "Generator<number, number, unknown>" : "number";
  const reader =
    shape === "arrow"
      ? `const read${index} = (${parameters}): ${result} => ${block};`
      : `${shape === "async" ? "async " : ""}function${shape === "generator" ? "*" : ""} read${index}(${parameters}): ${result} ${block}`;
  const called = `read${index}${call(`make${index}(at)`)}`;
  const use = shape === "async" ? `sum = mix(sum, await ${called});` : shape === "generator" ? `for (const step of ${called}) sum = mix(sum, step);` : `sum = mix(sum, ${called});`;
  return `function make${index}(i: number): ${type} {
${thing.make}
}
${thing.elsewhere ? thing.elsewhere + "\n" : ""}${reader}
{
  let sum = 0;
  for (let round = 0; round < ${rounds}; round++) {
    const at = ${thing.first} + ${thing.step} * round;
    ${use}
  }
  console.log("${index} ${held}, ${shape}:", sum);
}`;
}

export function generate(random: Random): string {
  const declarations = new Set<string>();
  const scenes = Array.from({ length: random.between(1, 4) }, (_, index) => scene(random, index, declarations));
  return [prelude, ...declarations, ...scenes, "export {};"].join("\n") + "\n";
}

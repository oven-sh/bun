// Objects with thirty to three hundred members, read by name, by key and by symbol, directly and from below through a chain of prototypes.
// Where a member lies, inside the object or beside it, wide or narrow, goes by its number, and a small object never reaches the places where that changes.
//
//   holder    a literal, a class with fields, a class whose constructor stores, three levels of classes, a constructor function, an object grown name by name,
//             data on the prototype of a class, static members, methods and getters
//   members   around 32, 64, 128 and 256 or anywhere between; whole numbers, fractions, strings, booleans, objects, lists, functions, big integers, null or undefined at times, what nobody can know; some under symbols
//   receiver  the holder, one or two ordinary objects below it, a literal with `__proto__`, an instance of a class below it, a frozen object below it
//   read      by name through the declared type, by name through `any`, by a key that arrives, by symbol, by Reflect.get with another receiver
//   looked at own keys in their order, `for-in`, a spread, a rest, entries, descriptors, `in`, JSON
//   change    a store from below, a store into the holder, a store of another kind, a delete, an accessor, forty more members, a freeze, another prototype, nothing
//
// Every reader runs a few or some thousand times, then comes the change, then all is read again.
import type { Random } from "./random";

const prelude = `const given: unknown[] = JSON.parse('[0.5, 1, "two", null, {"v": 4}]');
function digest(values: unknown[]): string {
  let hash = 0;
  for (let value of values) {
    for (let calls = 0; typeof value === "function" && calls < 3; calls++) value = (value as () => unknown)();
    const text = typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : String(value);
    for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
    hash = (Math.imul(hash, 31) + 7) | 0;
  }
  return values.length + ":" + (hash >>> 0).toString(36);
}
function attempt(label: string, run: () => unknown): void {
  let answer: string;
  try {
    answer = String(run());
  } catch (error) {
    answer = "THROWS " + (error as Error).constructor.name;
  }
  console.log(label + " " + answer);
}
`;

const kinds: { type: string; value: (i: number) => string }[] = [
  { type: "number", value: i => `${i}` },
  { type: "number", value: i => `${i}.5` },
  { type: "string", value: i => `"s${i}"` },
  { type: "boolean", value: i => `${i % 2 === 0}` },
  { type: "number | null", value: i => (i % 3 ? `${i}` : "null") },
  { type: "{ v: number }", value: i => `{ v: ${i} }` },
  { type: "number[]", value: i => `[${i}, ${i + 1}]` },
  { type: "bigint", value: i => `${i}n` },
  { type: "() => number", value: i => `() => ${i}` },
  { type: "number | string", value: i => (i % 2 ? `${i}` : `"m${i}"`) },
  { type: "unknown", value: i => `given[${i % 5}]` },
  { type: "number | undefined", value: i => (i % 2 ? `${i}` : "undefined") },
];

const holders = ["literal", "fields", "constructor", "levels", "function", "grown", "prototype data", "statics", "methods"] as const;

function oneCase(random: Random, k: number): string {
  const holder = random.pick(holders);
  const count = random.chance(0.6) ? random.pick([32, 64, 64, 64, 128, 256]) + random.between(-3, 5) : random.between(30, 300);
  // One kind for all, a few kinds, or every kind: narrow members are packed, so what lies where goes by the mix.
  const mix = random.pick([1, 2, 3, kinds.length]);
  const mine = Array.from({ length: mix }, () => random.below(kinds.length));
  const members = Array.from({ length: count }, (_, i) => {
    const isSymbol = holder !== "statics" && random.chance(0.06);
    return { key: isSymbol ? `[y${k}_${i}]` : `f${i}`, read: isSymbol ? `[y${k}_${i}]` : `.f${i}`, text: isSymbol ? `y${k}_${i}` : `"f${i}"`, isSymbol, kind: kinds[mine[random.below(mix)]], i };
  });
  const lines: string[] = members.filter(member => member.isSymbol).map(member => `const ${member.text} = Symbol("${member.text}");`);
  const value = (member: (typeof members)[number]) => member.kind.value(member.i);
  let typed = `H${k}`;
  let make = `new H${k}()`;
  switch (holder) {
    case "literal":
      lines.push(`function make${k}() {\n  return { ${members.map(member => `${member.key}: (${value(member)}) as ${member.kind.type}`).join(", ")} };\n}`, `type H${k} = ReturnType<typeof make${k}>;`);
      make = `make${k}()`;
      break;
    case "fields":
      lines.push(`class H${k} {\n${members.map(member => `  ${member.key}: ${member.kind.type} = ${value(member)};`).join("\n")}\n}`);
      break;
    case "constructor":
      lines.push(`class H${k} {\n${members.map(member => `  ${member.key}: ${member.kind.type};`).join("\n")}\n  constructor() {\n${members.map(member => `    this${member.read} = ${value(member)};`).join("\n")}\n  }\n}`);
      break;
    case "levels": {
      const cuts = [0, Math.floor(count / 3), Math.floor((2 * count) / 3), count];
      for (let level = 0; level < 3; level++) lines.push(`class ${level === 2 ? `H${k}` : `L${k}_${level}`}${level ? ` extends L${k}_${level - 1}` : ""} {\n${members.slice(cuts[level], cuts[level + 1]).map(member => `  ${member.key}: ${member.kind.type} = ${value(member)};`).join("\n")}\n}`); // prettier-ignore
      break;
    }
    case "function":
      lines.push(`function H${k}(this: any) {\n${members.map(member => `  this${member.read} = ${value(member)};`).join("\n")}\n}`);
      typed = "any";
      make = `new (H${k} as any)()`;
      break;
    case "grown":
      lines.push(`function make${k}(): any {\n  const o: any = {};\n${members.map(member => `  o${member.read} = ${value(member)};`).join("\n")}\n  return o;\n}`);
      typed = "any";
      make = `make${k}()`;
      break;
    case "prototype data":
      lines.push(`class H${k} {}`, `Object.assign(H${k}.prototype, { ${members.map(member => `${member.key}: ${value(member)}`).join(", ")} });`);
      typed = "any";
      make = `H${k}.prototype`;
      break;
    case "statics":
      lines.push(`class H${k} {\n${members.map(member => `  static ${member.key}: ${member.kind.type} = ${value(member)};`).join("\n")}\n}`);
      typed = `typeof H${k}`;
      make = `H${k}`;
      break;
    case "methods":
      lines.push(`class H${k} {\n${members.map(member => (member.i % 2 ? `  get ${member.key}(): ${member.kind.type} {\n    return ${value(member)};\n  }` : `  ${member.key}(): ${member.kind.type} {\n    return ${value(member)};\n  }`)).join("\n")}\n}`);
      typed = "any";
      make = `H${k}.prototype`;
  }
  const all = (o: string) => members.map(member => o + member.read).join(", ");
  lines.push(
    `function typed${k}(o: ${typed}): string {\n  return digest([${all("o")}]);\n}`,
    `function loose${k}(o: any): string {\n  return digest([${all("o")}]);\n}`,
    `const keys${k}: (string | symbol)[] = [${members.map(member => member.text).join(", ")}];`,
    `function keyed${k}(o: any): string {\n  const values: unknown[] = [];\n  for (const key of keys${k}) values.push(o[key]);\n  return digest(values);\n}`,
  );
  // The members that the changes and the single reads are about: the last, and those where the sixty-fourth word and its like lie.
  const near = [count - 1, ...[30, 31, 32, 62, 63, 64, 65, 66, 67, 127, 128, 129, 255, 256].filter(i => i < count)];
  const at = () => members[random.chance(0.8) ? random.pick(near) : random.below(count)];
  const receivers = [`h`, `Object.create(h)`, `Object.create(Object.create(h))`, `{ __proto__: h, own: 1 }`, `new (class Below${k} { own = 1; static { Object.setPrototypeOf(this.prototype, h); } })()`, `Object.freeze(Object.create(h))`];
  const chosen = receivers.filter((_, index) => index === 0 || random.chance(0.5));
  const turns = random.pick([1, 3, 300, 300, count < 100 ? 4000 : 1000]);
  const [a, b, c] = [at(), at(), at()];
  const change = random.pick([
    `receivers[receivers.length - 1]${a.read} = "from below";`,
    `loose${a.read} = ${a.kind.value(a.i + 1000)}; loose${b.read} = ${b.kind.value(b.i + 1000)};`,
    `loose${a.read} = ${random.pick([`"another kind"`, `0.25`, `null`, `{ v: "w" }`, `undefined`, `2 ** 40`, `-0`])};`,
    `delete loose${a.read};`,
    `delete loose${a.read}; loose${a.read} = "again";`,
    `Object.defineProperty(loose, ${a.text}, { get() { return "got " + (this === loose); }, configurable: true, enumerable: true });`,
    `for (let i = 0; i < 40; i++) loose["more" + i] = i;`,
    `for (let i = 0; i < 40; i++) loose["more" + i] = i; loose${a.read} = "behind more";`,
    `Object.freeze(loose);`,
    `Object.setPrototypeOf(receivers[receivers.length - 1], { ${a.key}: "another above" });`,
    `Object.setPrototypeOf(loose, { absent: "appears" });`,
    ``,
  ]);
  const looks = [
    `attempt("${k} own keys", () => digest(Reflect.ownKeys(loose).map(key => (typeof key === "symbol" ? key.description : key))));`,
    `attempt("${k} for-in", () => { const seen: string[] = []; for (const key in receivers[receivers.length - 1]) seen.push(key); return digest(seen); });`,
    `attempt("${k} spread", () => keyed${k}({ ...loose }));`,
    `attempt("${k} rest", () => { const { ${a.isSymbol ? `[${a.text}]` : a.key}: taken, ...rest } = loose; return digest([taken]) + " " + keyed${k}(rest); });`,
    `attempt("${k} entries", () => digest(Object.entries(loose).flat()));`,
    `attempt("${k} descriptors", () => JSON.stringify([Object.getOwnPropertyDescriptor(loose, ${b.text}), Object.getOwnPropertyDescriptor(loose, ${c.text})], (_, v) => (typeof v === "bigint" || typeof v === "function" ? typeof v : v)));`,
    `attempt("${k} in", () => [${a.text} in loose, ${b.text} in receivers[receivers.length - 1], Object.hasOwn(loose, ${c.text}), "absent" in loose, loose.absent].join());`,
    `attempt("${k} JSON", () => digest([JSON.stringify(loose)]));`,
    `attempt("${k} Reflect.get", () => digest([Reflect.get(loose, ${a.text}, receivers[receivers.length - 1]), Reflect.get(receivers[receivers.length - 1], ${b.text})]));`,
    `attempt("${k} single", () => digest([loose${a.read}, receivers[receivers.length - 1]${b.read}, receivers[0]${c.read}]));`,
    `attempt("${k} assign", () => keyed${k}(Object.assign({}, loose)));`,
  ].filter(() => random.chance(0.45));
  const read = `  for (const [index, receiver] of receivers.entries()) attempt("${k} receiver " + index, () => loose${k}(receiver) + " " + keyed${k}(receiver));\n  attempt("${k} typed", () => typed${k}(h));\n${looks.map(look => "  " + look).join("\n")}`;
  lines.push(
    `{\n  const h = ${make};\n  const loose: any = h;\n  const receivers: any[] = [${chosen.join(", ")}];\n  let last = "";\n  for (let turn = 0; turn < ${turns}; turn++) for (const receiver of receivers) last = ${random.pick([`loose${k}(receiver)`, `keyed${k}(receiver)`, `loose${k}(receiver) + keyed${k}(receiver)`, `typed${k}(h) + loose${k}(receiver)`])};\n  console.log("${k} ${holder} ${count} " + last);\n${read}\n  attempt("${k} change", () => { ${change} });\n${read}\n}`,
  );
  return lines.join("\n");
}

export function generate(random: Random): string {
  return prelude + Array.from({ length: random.pick([1, 1, 2, 3]) }, (_, k) => oneCase(random, k)).join("\n") + "\n";
}

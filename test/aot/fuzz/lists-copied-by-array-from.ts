// `Array.from(list)` and `[...list]` of a list: a compiler may copy the storage when it knows nothing can see the difference. Each
// scene varies what that rests on: holes, inherited elements, a list changed by the walk, a subclass, a list that replaced its own
// iterator, an array-like, a map function, and what is asked of the copy (its holes, its length, its kind, whether it is shared).
import type { Random } from "./random";

const sources = [
  "[1, 2, 3]",
  "[1, 2, 3]",
  "[1.5, 2.5]",
  '["a", "b"]',
  "[{ v: 1 }, { v: 2 }]",
  "[1, , 3]",
  "[, ,]",
  "new Array(3)",
  "[1, 2, , 4, , 6]",
  "[1.5, , 2.5]",
  '["a", , "c"]',
  "[]",
  "Object.assign([1, , 3], { extra: 1 })",
  "new Sub(1, 2, 3)",
  "withInherited()",
  "withOwnIterator()",
  "withGetter()",
  "frozen",
  "new Set([1, 2, 2])",
  "new Map([[1, 2]])",
  '"text"',
  "new Uint8Array([1, 2])",
  "{ length: 2, 0: 5, 1: 6 }",
  "{ length: 2, 0: 5 }",
  "[1, 2].values()",
  "gives()",
  "null",
  "undefined",
];

const copies = [
  "Array.from(list)",
  "Array.from(list)",
  "Array.from(list)",
  "[...list]",
  "[...list]",
  "[0, ...list]",
  "[...list, ...list]",
  "Array.from(list, each => each)",
  "Array.from(list, (each, at) => at)",
  "Array.from(list, function (this: ANY, each) { return this === undefined ? each : this.base; }, { base: 7 })",
  "Sub.from(list)",
  "FROM.call(Sub, list)",
  "FROM.call(Object, list)",
  "Array.from(new Set(list))",
  "Array.from(new Set(list))",
  "Array.from(new Map(list))",
  "Array.from(new SubSet(list))",
  "Array.from(new Set(list).values())",
  "list.slice()",
  "list.concat()",
  "Array.of(...list)",
  "list.toSorted()",
  "list.with(0, 9)",
];

const changes = [
  "copy[0] = 100;",
  "list[0] = 100;",
  "copy.push(5);",
  "list.push(5);",
  "copy.length = 1;",
  "list.length = 0;",
  "copy[1] = 2.5;",
  'copy[1] = "text";',
  "delete copy[0];",
  "copy.reverse();",
];

const asks = [
  "copy.length",
  "JSON.stringify(copy)",
  "0 in copy",
  "1 in copy",
  "Object.keys(copy).join()",
  "copy[1]",
  "copy[5]",
  "copy.indexOf(undefined)",
  "copy.includes(undefined)",
  "copy.join()",
  "Array.isArray(copy)",
  "copy instanceof Sub",
  "copy === list",
  "copy.extra",
  "Object.getPrototypeOf(copy) === Array.prototype",
  "copy.map(each => 1).length",
  "copy.flat().length",
  "Object.isFrozen(copy)",
  "list.length",
  "JSON.stringify(list)",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const failure = typed ? "(error as Error).name" : "error.name";
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.35);
    const source = isPlain ? random.pick(sources.slice(0, 5)) : random.pick(sources);
    const copy = (isPlain ? random.pick(copies.slice(0, 5)) : random.pick(copies))
      .replace(/each =>/g, typed ? "(each: any) =>" : "each =>")
      .replace(/\(each, at\)/g, typed ? "(each: any, at: number)" : "(each, at)")
      .replace(/this: ANY, each/g, typed ? "this: any, each: any" : "each")
      .replace("FROM", typed ? "(Array.from as any)" : "Array.from");
    const change = isPlain || random.chance(0.5) ? "" : random.pick(changes);
    const asked = random.sample(asks, random.between(1, 4));
    const inner = random.chance(0.3);
    const turns = random.pick([6, 60, 400, 3000]);
    const rare = !isPlain && random.chance(0.25) ? random.pick(sources) : "";
    scenes.push(`function copy${scene}(turn${as("number")}) {
  let list${as("any")} = ${rare ? `turn % 11 === 10 ? ${rare} : ` : ""}${source};
  ${inner ? "const hold = list;" : ""}
  const copy${as("any")} = ${copy.replace(/\blist\b/g, typed ? "(list as any)" : "list")};
  ${change}
  return [${asked.map(ask => `String(${ask})`).join(", ")}].join(" ");
}
{
  let hash = 0;
  let last = "";
  for (let turn = 0; turn < ${turns}; turn++) {
    try {
      last = copy${scene}(turn);
    } catch (error) {
      last = "threw " + ${failure};
    }
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}`);
  }
  return `class Sub extends Array${typed ? "<any>" : ""} {}
class SubSet extends (Set${typed ? " as any" : ""}) {
  *[Symbol.iterator]() {
    yield "own";
  }
}
const frozen = Object.freeze([1, 2]);
function withInherited() {
  const list = [1, , 3];
  Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: "inherited" } }));
  return list;
}
function withOwnIterator() {
  const list${as("any")} = [1, 2];
  list[Symbol.iterator] = function* () {
    yield 9;
  };
  return list;
}
function withGetter() {
  const list${as("any")} = [1, 2];
  Object.defineProperty(list, 0, { get() { list.length = 1; return 8; } });
  return list;
}
function* gives() {
  yield 1;
  yield 2;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}

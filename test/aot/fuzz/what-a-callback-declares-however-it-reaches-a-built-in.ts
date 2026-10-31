// A built-in runs a callback once for each element, and the callback declares things: variables that closures share, functions, classes, objects, generators. Each run makes them anew, however the callback came to the built-in.
//
//   the built-in  forEach, map, filter, some, every, find, findIndex, findLast, flatMap, reduce, reduceRight and Array.from over a list or over an object that only looks like one; forEach of a Map, of a Set, of bytes;
//                 replace and replaceAll with a function; the reviver of JSON.parse, the replacer of JSON.stringify
//   the road      called as a method; by a computed name; through call, apply, Reflect.apply, bind with and without the callback, call of call, call bound to the method, apply of call, a spread list of arguments;
//                 through a function of the program that applies what it is given, or that is itself entered through call and hands its parameter on
//   the callback  a function expression, an arrow, a declared function, a bound one, one wrapped in an arrow, one that is also called by hand before or afterwards
//   declares      a variable that one closure counts up, that two closures share; a named function with a member; an object, a list; a class with a static member, a class with a method; a generator; closures two deep; a `var`
//   then          everything that was made is called twice, counted as a set, and the first is compared with the last
import type { Random } from "./random";

const prelude = `const made = [];
let quiet = false;
function tell(label) {
  const said = [];
  for (let round = 0; round < 2; round++) said.push(made.map(one => { try { return String(one()); } catch (error) { return error.constructor.name; } }).join());
  if (!quiet) console.log(label, made.length, said.join(" "), new Set(made).size, made.length > 1 ? made[0] === made[made.length - 1] : "");
  made.length = 0;
}
function invoke(method, self, ...rest) {
  return method.apply(self, rest);
}
function handOn(list, name, callback) {
  return list[name](callback);
}`;

// Bodies of the callback: `item` is a number that differs from run to run.
export const declares = [
  `let count = item * 10;\n  made.push(() => ++count);`,
  `let count = item * 10;\n  made.push(() => ++count, () => count);`,
  `function named() {\n    return item;\n  }\n  named.mark = item;\n  made.push(() => named() + ":" + named.mark);`,
  `function named() {\n    return item;\n  }\n  made.push(named);`,
  `const own = { n: item };\n  made.push(() => own.n++);`,
  `const own = [item];\n  made.push(() => own.push(item));`,
  `const Own = class {\n    static value = item;\n  };\n  made.push(() => Own.value++);`,
  `class Own {\n    get() {\n      return item;\n    }\n  }\n  made.push(() => new Own().get());`,
  `class Own {\n    static all = [];\n  }\n  made.push(() => Own.all.push(item));`,
  `function* steps() {\n    yield item;\n    yield item + 1;\n  }\n  const walk = steps();\n  made.push(() => walk.next().value);`,
  `let outer = item;\n  const deep = () => () => ++outer;\n  made.push(deep());`,
  `var count = item * 10;\n  made.push(function () {\n    return ++count;\n  });`,
  `const table = new Map([[item, item]]);\n  made.push(() => (table.set(table.size + item, 0), table.size));`,
  `let text = "";\n  made.push(() => (text += item));`,
  `const [first, second = () => first] = [item];\n  made.push(second);`,
  `let count = item;\n  const both = { up: () => ++count, read: () => count };\n  made.push(both.up, both.read);`,
  `for (let i = 0; i < 2; i++) made.push(() => item * 10 + i);`,
  `const self = () => self;\n  made.push(() => self() === self && item);`,
];

type Walk = { method: string; receiver: string; owner: string; parameters: string; item?: string; answers: string; more?: string };
const list = "[1, 2, 3]";
const like = "{ length: 3, 0: 1, 1: 2, 2: 3 }";
const overLists = (receiver: string): Walk[] => [
  ...["forEach", "forEach", "map", "filter", "flatMap"].map(method => ({ method, receiver, owner: "Array.prototype", parameters: "item", answers: "item" })),
  ...["some", "find", "findIndex", "findLast"].map(method => ({ method, receiver, owner: "Array.prototype", parameters: "item", answers: "false" })),
  { method: "every", receiver, owner: "Array.prototype", parameters: "item", answers: "true" },
  { method: "reduce", receiver, owner: "Array.prototype", parameters: "sum, item", answers: "sum + item", more: ", 0" },
  { method: "reduceRight", receiver, owner: "Array.prototype", parameters: "sum, item", answers: "sum + item", more: ", 0" },
];
const walks: Walk[] = [
  ...overLists(list),
  ...overLists(list),
  ...overLists(like),
  { method: "forEach", receiver: "new Map([[1, 4], [2, 5], [3, 6]])", owner: "Map.prototype", parameters: "item", answers: "item" },
  { method: "forEach", receiver: "new Set([7, 8, 9])", owner: "Set.prototype", parameters: "item", answers: "item" },
  { method: "forEach", receiver: "new Uint8Array([1, 2, 3])", owner: "Uint8Array.prototype", parameters: "item", answers: "item" },
  { method: "map", receiver: "new Float64Array([1.5, 2.5])", owner: "Float64Array.prototype", parameters: "item", answers: "item" },
  { method: "replace", receiver: `"a1b2c3"`, owner: "String.prototype", parameters: "found", item: "Number(found)", answers: `"x"`, more: "FIRST/\\d/g, " },
  { method: "replaceAll", receiver: `"4-5-6"`, owner: "String.prototype", parameters: "found", item: "Number(found)", answers: `"y"`, more: "FIRST/\\d/g, " },
];

function scene(random: Random, index: number): string {
  const walk = random.pick(walks);
  const body = `${walk.item ? `  const item = ${walk.item};\n` : ""}  ${random.pick(declares)}\n  return ${walk.answers};`;
  const kind = random.weighted([[4, "function"], [3, "arrow"], [2, "declared"], [1, "bound"], [1, "wrapped"], [1, "also by hand"]] as const); // prettier-ignore
  const expression = `function (${walk.parameters}) {\n${body}\n}`;
  const name = `callback${index}`;
  const isDeclared = kind !== "function" && kind !== "arrow";
  const callback = kind === "function" ? expression : kind === "arrow" ? `(${walk.parameters}) => {\n${body}\n}` : kind === "bound" ? `${name}.bind(null)` : kind === "wrapped" ? `(...all) => ${name}(...all)` : name;
  const first = walk.more?.startsWith("FIRST") ? walk.more.slice(5) : "";
  const last = walk.more && !first ? walk.more : "";
  const given = `${first}${callback}${last}`;
  const method = `${walk.owner}.${walk.method}`;
  const self = `subject${index}`;
  const isAList = walk.receiver === list;
  const roads = [
    `${method}.call(${self}, ${given})`,
    `${method}.call(${self}, ${given})`,
    `${method}.apply(${self}, [${given}])`,
    `${method}.apply(${self}, [${given}])`,
    `Reflect.apply(${method}, ${self}, [${given}])`,
    `Reflect.apply(${method}, ${self}, [${given}])`,
    `${method}.bind(${self})(${given})`,
    `${method}.bind(${self}, ${given})()`,
    `Function.prototype.call.call(${method}, ${self}, ${given})`,
    `Function.prototype.call.bind(${method})(${self}, ${given})`,
    `Function.prototype.call.apply(${method}, [${self}, ${given}])`,
    `Function.prototype.apply.call(${method}, ${self}, [${given}])`,
    `invoke(${method}, ${self}, ${given})`,
    `invoke.call(null, ${method}, ${self}, ${given})`,
    ...(walk.receiver === like ? [] : [`${self}.${walk.method}(${given})`, `${self}[${JSON.stringify(walk.method)}](${given})`, `${self}.${walk.method}(...[${given}])`, `${self}.${walk.method}.call(${self}, ${given})`]),
    ...(walk.receiver === like || walk.more ? [] : [`handOn(${self}, ${JSON.stringify(walk.method)}, ${given})`, `handOn.call(null, ${self}, ${JSON.stringify(walk.method)}, ${given})`, `handOn.apply(null, [${self}, ${JSON.stringify(walk.method)}, ${given}])`, `Reflect.apply(handOn, null, [${self}, ${JSON.stringify(walk.method)}, ${given}])`]),
    ...(isAList && !walk.more && walk.method === "map" ? [`Array.from(${self}, ${given})`, `Array.from.call(Array, ${self}, ${given})`, `Reflect.apply(Array.from, Array, [${self}, ${given}])`] : []),
  ];
  const road = random.pick(roads);
  const where = random.weighted([[3, "top"], [2, "function"], [1, "loop"]] as const); // prettier-ignore
  const byHand = kind === "also by hand" ? `${name}(${walk.parameters === "sum, item" ? "0, 40" : walk.item ? `"40"` : "40"});\n` : "";
  const act = `${random.chance(0.5) ? byHand : ""}const subject${index} = ${walk.receiver};\n${road};\n${byHand && random.chance(0.5) ? byHand : ""}tell(${JSON.stringify(`${index} ${walk.method}`)});`;
  return `${isDeclared ? `function ${name}(${walk.parameters}) {\n${body}\n}\n` : ""}${
    where === "top" ? `{\n${act}\n}` : where === "function" ? `function act${index}() {\n${act}\n}\nact${index}();${random.chance(0.5) ? `\nact${index}();` : ""}` : `for (let turn = 0; turn < 60; turn++) {\n  quiet = turn > 0 && turn < 59;\n${act}\n}`
  }`;
}

export function generate(random: Random): string {
  return [prelude, ...Array.from({ length: random.between(2, 6) }, (_, index) => scene(random, index))].join("\n") + "\n";
}

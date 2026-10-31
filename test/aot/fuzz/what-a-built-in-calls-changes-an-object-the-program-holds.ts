// A built-in calls or constructs something of the program's through a protocol, and that changes an object the program already holds. Afterwards the object is read in every way.
//
//   called by   the species of `RegExp`, `Promise`, `Array`, `ArrayBuffer` and typed arrays; `Symbol.split`, `match`, `matchAll`, `replace`, `search`, `iterator`, `asyncIterator`, `toPrimitive`, `hasInstance`,
//               `isConcatSpreadable`; `next` and `return` of an iterator; `then`; `toJSON`; `valueOf` and `toString` under thirty operators and built-ins; comparators, replacers, revivers, mappers, tests
//               and reducers of lists, typed arrays, maps and sets; functions handed to `replace`; getters read by `Object.assign`, spreads, `Object.entries` and `JSON.stringify`; traps of proxies;
//               `Reflect.apply` and `construct`, `call`, `apply`, bound functions; jobs and timers
//   or itself   the protocol's function hands the held object back, or the built-in is called on it, and the built-in itself writes into it: `lastIndex`, elements, `length`
//   changes     a member is added, by name, under a key, by `Object.assign`, by `defineProperty`; stored to with a value of another kind; deleted; turned into a getter; the prototype is changed;
//               a list is pushed to, shortened, given a hole, given a text among numbers
//   the object  an instance with fields, a literal, a list of whole numbers, of fractions, of objects, a function, a class, an object without a prototype, a member of another object
//   written     where the protocol's function stands, in a function declared elsewhere, in a closure, in a method of the object itself
//   read        ahead of the call and behind it: in the same expression, in the next statement, in another function, in a closure made ahead, in a method of the object; by name, under a key, by `in`,
//               `Object.keys`, `JSON.stringify`, `for .. in`, a pattern, `typeof`
import type { Random } from "./random";

// The head uses as few built-ins as it can: one that it used would be known to the compiler in every program.
const head = `process.on("unhandledRejection", () => {});
function show(value, depth = 0) {
  if (typeof value === "function") return "function";
  if (typeof value === "string") return '"' + value + '"';
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "bigint") return value + "n";
  if (value === null || typeof value !== "object") return value === 0 && 1 / value < 0 ? "-0" : "" + value;
  if (depth > 2) return "..";
  let text = "";
  if (Array.isArray(value)) {
    for (let at = 0; at < value.length; at++) text += (at ? "," : "") + (at in value ? show(value[at], depth + 1) : "hole");
    return "[" + text + "]";
  }
  for (const key in value) text += (text ? "," : "") + key + ":" + show(value[key], depth + 1);
  return "{" + text + "}";
}
function note(...parts) {
  let text = "";
  for (let at = 0; at < parts.length; at++) text += (at ? " " : "") + (typeof parts[at] === "string" ? parts[at] : show(parts[at]));
  console.log(text);
}
const other = { inherited: "from the other prototype" };
function elsewhere(given) {
  let names = "";
  for (const name in given) names += "+" + name;
  return [given.a, given.b, given.added, given[0], given.length, typeof given.added, "added" in given, names];
}
`;

const small = `function note(...parts) {
  console.log(parts.join(" "));
}
const other = { inherited: "from the other prototype" };
`;

export function generate(random: Random): string {
  const rows: string[] = [];
  // In half of the programs the object is handed to no function of the program and no closure reads it, and nothing else happens in the program: so the compiler knows everything that is done to it.
  const isKeptClose = random.chance(0.5);
  for (let id = 0, scenes = isKeptClose ? 1 : random.between(1, 3); id < scenes; id++) {
    const kind = random.weighted([
      [4, "instance"],
      [4, "literal"],
      [2, "whole numbers"],
      [1, "fractions"],
      [1, "objects"],
      [1, "function"],
      [1, "class"],
      [1, "bare"],
      [1, "member"],
    ] as const);
    const isList = kind === "whole numbers" || kind === "fractions" || kind === "objects";
    const declared = {
      instance: `class Held${id} {\na = 1;\nb = { inner: 2 };\nread() {\nreturn [this.a, this.b, this.added, typeof this.added];\n}\nchange() {\nCHANGE_THIS\n}\n}\nconst held = new Held${id}();`,
      literal: `const held = {\na: 1,\nb: "text",\nread() {\nreturn [this.a, this.b, this.added, typeof this.added];\n},\nchange() {\nCHANGE_THIS\n},\n};`,
      "whole numbers": `const held = [1, 2, 3];`,
      fractions: `const held = [1.5, 2.5, 3.5];`,
      objects: `const held = [{ a: 1 }, { a: 2 }];`,
      function: `const held = function () {};\nheld.a = 1;`,
      class: `const held = class {\nstatic a = 1;\nstatic b = 2;\n};`,
      bare: `const held = Object.create(null);\nheld.a = 1;\nheld.b = 2;`,
      member: `const outer = { inner: { a: 1, b: 2 } };\nconst held = outer.inner;`,
    }[kind];
    const value = () =>
      random.pick([
        "5",
        "1.5",
        '"stored"',
        "null",
        "undefined",
        "{ fresh: 1 }",
        "[7]",
        "() => 1",
        "held.b",
        "true",
        "-0",
        "2 ** 31",
      ]);
    const change = (name: string): string =>
      random.weighted<() => string>([
        [5, () => `${name}.added = ${value()};`],
        [4, () => `${name}.a = ${value()};`],
        [2, () => `${name}["add" + "ed"] = ${value()};`],
        [2, () => `Object.assign(${name}, { added: ${value()} });`],
        [1, () => `Object.assign(${name}, { a: ${value()}, added: ${value()}, more: 1 });`],
        [
          2,
          () =>
            `Object.defineProperty(${name}, "added", { value: ${value()}, enumerable: true, configurable: true, writable: true });`,
        ],
        [3, () => `delete ${name}.a;`],
        [1, () => `delete ${name}.a;\n${name}.a = ${value()};`],
        [
          1,
          () =>
            `Object.defineProperty(${name}, "a", { get: () => "from a getter", enumerable: true, configurable: true });`,
        ],
        [kind === "class" || kind === "function" ? 0 : 1, () => `Object.setPrototypeOf(${name}, other);`],
        [1, () => `Reflect.set(${name}, "added", ${value()});`],
        [isList ? 4 : 0, () => `${name}.push(${value()});`],
        [isList ? 3 : 0, () => `${name}.length = ${random.pick(["0", "1", "5"])};`],
        [isList ? 3 : 0, () => `${name}[${random.pick(["0", "1", "6"])}] = ${value()};`],
        [isList ? 2 : 0, () => `delete ${name}[0];`],
        [
          isList ? 1 : 0,
          () =>
            random.pick([
              `${name}.reverse();`,
              `${name}.shift();`,
              `${name}.splice(0, 1, "spliced");`,
              `${name}.fill(9);`,
            ]),
        ],
      ])();
    const text = change("held");
    const hasMethods = kind === "instance" || kind === "literal";
    // Where the change is written.
    const [setup, fx] = random.weighted<[string, string]>([
      [5, ["", `{\ncalls++;\n${text}\n}`]],
      [3, [`function changes() {\ncalls++;\n${text}\n}`, `changes();`]],
      [
        2,
        [
          `const changes = (() => {\nconst target = held;\nreturn () => {\ncalls++;\n${change("target")}\n};\n})();`,
          `changes();`,
        ],
      ],
      [hasMethods ? 2 : 0, ["", `{\ncalls++;\nheld.change();\n}`]],
      [1, [`function changes(target) {\ncalls++;\n${change("target")}\n}`, `changes(held);`]],
    ]);
    const body = `if (calls < 2) ${fx.startsWith("{") ? fx : `{\n${fx}\n}`}`;
    const f = (answer: string, parameters = "") => `function (${parameters}) {\n${body}\nreturn ${answer};\n}`;
    const arrow = (answer: string, parameters = "") => `(${parameters}) => {\n${body}\nreturn ${answer};\n}`;
    const converts = `{ ${random.pick([`[Symbol.toPrimitive]: ${f("1")}`, `valueOf: ${f("1")}`, `toString: ${f('"1"')}`, `valueOf: ${f("{}")}, toString: () => "1"`])} }`;
    const trigger = random.pick<() => string>([
      () =>
        `(() => {\nconst pattern = /,/;\npattern.constructor = { [Symbol.species]: ${f("new RegExp(source, flags)", "source, flags")} };\nreturn "a,b".split(pattern).length;\n})()`,
      () =>
        `(() => {\nconst promise = Promise.resolve(1);\npromise.constructor = { [Symbol.species]: ${f("new Promise(run)", "run")} };\nreturn typeof promise.${random.pick(["then(() => {})", "catch(() => {})", "finally(() => {})"])};\n})()`,
      () =>
        `(() => {\nconst list = [1, 2];\nlist.constructor = { [Symbol.species]: ${f("new Array(size)", "size")} };\nreturn list.${random.pick(["map(each => each)", "filter(() => true)", "slice(0)", "splice(0, 1)", "concat([3])", "flat()", "flatMap(each => [each])"])}.length;\n})()`,
      () =>
        `(() => {\nconst buffer = new ArrayBuffer(4);\nbuffer.constructor = { [Symbol.species]: ${f("new ArrayBuffer(size)", "size")} };\nreturn buffer.slice(0, 2).byteLength;\n})()`,
      () =>
        `(() => {\nconst bytes = new Uint8Array([1, 2, 3]);\nbytes.constructor = { [Symbol.species]: ${f("new Uint8Array(...given)", "...given")} };\nreturn bytes.${random.pick(["map(each => each)", "filter(() => true)", "slice(0, 2)", "subarray(1)"])}.length;\n})()`,
      () => `"a,b".split({ [Symbol.split]: ${f("[]")} }).length`,
      () => `"ab".match({ [Symbol.match]: ${f("null")} })`,
      () => `"ab".matchAll({ [Symbol.matchAll]: ${f("[]")} }).length`,
      () => `"ab".replace({ [Symbol.replace]: ${f('"replaced"')} }, "x")`,
      () => `"ab".replaceAll({ [Symbol.replace]: ${f('"replaced"')} }, "x")`,
      () => `"ab".search({ [Symbol.search]: ${f("0")} })`,
      () => {
        const iterable = random.pick([
          `{ [Symbol.iterator]: ${f("[1, 2][Symbol.iterator]()")} }`,
          `{\n[Symbol.iterator]() {\nlet at = 0;\nreturn { next: ${f("{ done: at++ > 1, value: [at, at] }")} };\n},\n}`,
          `{\n[Symbol.iterator]() {\nreturn { next: () => ({ done: false, value: [1, 1] }), return: ${f("{}")} };\n},\n}`,
        ]);
        const isEndless = iterable.includes("done: false");
        return isEndless
          ? random.pick([
              `(([first]) => first)(${iterable})`,
              `(() => {\nfor (const each of ${iterable}) return each;\n})()`,
              `(() => {\nconst [first] = ${iterable};\nreturn first;\n})()`,
            ])
          : random.pick([
              `[...${iterable}].length`,
              `Array.from(${iterable}).length`,
              `new Set(${iterable}).size`,
              `Math.max(...[...${iterable}].flat())`,
              `typeof Promise.all(${iterable})`,
              `(() => {\nlet seen = 0;\nfor (const each of ${iterable}) seen++;\nreturn seen;\n})()`,
              `new Uint8Array(${iterable}).length`,
              `[...(function* () {\nyield* ${iterable};\n})()].length`,
            ]);
      },
      () =>
        `await (async () => {\nlet seen = 0;\nfor await (const each of { [Symbol.asyncIterator]: ${f("(async function* () {\nyield 1;\n})()")} }) seen++;\nreturn seen;\n})()`,
      () =>
        random.pick([
          `+${converts}`,
          `\`\${${converts}}\``,
          `${converts} + ""`,
          `${converts} < 2`,
          `${converts} == 1`,
          `Number(${converts})`,
          `String(${converts})`,
          `[${converts}].join()`,
          `Math.max(0, ${converts})`,
          `"x".repeat(${converts})`,
          `[5, 6][${converts}]`,
          `({ 1: "found" })[${converts}]`,
          `new Date(${converts}).getTime()`,
          `parseInt(${converts})`,
          `"a".padStart(${converts})`,
          `[1, 2, 3].at(${converts})`,
          `[1, 2, 3].slice(${converts}).length`,
          `isNaN(${converts})`,
          `"abc".charAt(${converts})`,
          `"abc".indexOf("c", ${converts})`,
          `new Array(3).fill(0, ${converts}).length`,
          `${converts} * 2`,
          `-${converts}`,
          `${converts} | 0`,
          `1 in { [${converts}]: 1 }`,
          `Object.hasOwn({ 1: 1 }, ${converts})`,
          `new Uint8Array(2).fill(${converts})[0]`,
          `(5).toString(${converts} + 9)`,
          `Symbol(${converts}).description`,
          `BigInt(${converts})`,
        ]),
      () => `1 instanceof { [Symbol.hasInstance]: ${f("true")} }`,
      () => `[].concat({ get [Symbol.isConcatSpreadable]() {\n${body}\nreturn false;\n} }).length`,
      () => `await { then: ${f("done(1)", "done")} }`,
      () => `typeof Promise.resolve({ then: ${f("done(1)", "done")} }) + (await null)`,
      () => `JSON.stringify({ toJSON: ${f("1")} })`,
      () => `JSON.stringify([{ toJSON: ${f("1")} }, new Date(0)]).length`,
      () => `[2, 1, 3].${random.pick(["sort", "toSorted"])}(${arrow("first - second", "first, second")}).length`,
      () => `new Float64Array([2, 1]).sort(${arrow("first - second", "first, second")}).length`,
      () => `JSON.stringify({ k: 1 }, ${arrow("each", "key, each")})`,
      () => `JSON.parse("[1]", ${arrow("each", "key, each")}).length`,
      () =>
        `[1, 2].${random.pick(["map", "forEach", "filter", "find", "findLast", "some", "every", "flatMap", "findIndex"])}(${arrow("each", "each")}) === null`,
      () => `[1, 2].${random.pick(["reduce", "reduceRight"])}(${arrow("sum + each", "sum, each")}, 0)`,
      () => `Array.from([1, 2], ${arrow("each", "each")}).length`,
      () => `Array.from({ length: 2 }, ${arrow("1")}).length`,
      () =>
        `"aa".${random.pick(["replace(/a/,", "replace(/a/g,", 'replaceAll("a",', 'replace("a",'])} ${arrow('"b"')})`,
      () => `new ${random.pick(["Map([[1, 1]])", "Set([1])"])}.forEach(${arrow("0")})`,
      () => `Object.keys(Object.groupBy([1, 2], ${arrow('"k"')})).length`,
      () => `new Uint8Array(2).${random.pick(["map", "forEach", "filter", "some"])}(${arrow("0")}) === null`,
      () => `Object.keys(Object.assign({}, { get g() {\n${body}\nreturn 1;\n} })).length`,
      () => `Object.keys({ ...{ get g() {\n${body}\nreturn 1;\n} } }).length`,
      () =>
        `${random.pick(["Object.entries", "Object.values", "JSON.stringify", "structuredClone"])}({ get g() {\n${body}\nreturn 1;\n} }) === null`,
      () =>
        `${random.pick(["Object.keys", "Reflect.ownKeys", "Object.getOwnPropertyNames", "JSON.stringify"])}(new Proxy({}, { ownKeys: ${f("[]")} })).length`,
      () => `new Proxy({}, { get: ${f("1")} }).anything`,
      () => `"k" in new Proxy({}, { has: ${f("true")} })`,
      () => `Reflect.apply(${f("1")}, null, [])`,
      () => `typeof Reflect.construct(${f("{}")}, [])`,
      () => `(${f("1")}).${random.pick(["call(null)", "apply(null, [])", "bind(null)()"])}`,
      () => `await new Promise(done => queueMicrotask(() => {\n${body}\ndone(1);\n}))`,
      () => `await new Promise(done => setTimeout(() => {\n${body}\ndone(1);\n}, 0))`,
      () => `await Promise.resolve().then(${arrow("1")})`,
      () =>
        `new (class extends Array {\nstatic get [Symbol.species]() {\n${body}\nreturn Array;\n}\n})(1, 2).map(each => each).length`,
      () => `Object.defineProperty({}, "k", { get value() {\n${body}\nreturn 1;\n} }).k`,
      () =>
        `new Map([[1, 1]]).${random.pick(["getOrInsertComputed?.(2,", "getOrInsertComputed?.(3,"])} ${arrow("1")}) ?? (${arrow("1")})()`,
    ])();
    /** The protocol's function hands the held object back, or the built-in is called on it, and the built-in itself writes into it. */
    const handsBack = `function () {\ncalls++;\nreturn held;\n}`;
    // What the call needs stands ahead of the expression, so that the call of the built-in itself stands beside the read.
    const [ahead, writes] = random.pick<() => [string, string]>([
      () => [
        `held.exec = () => null;\nconst pattern = /,/;\npattern.constructor = { [Symbol.species]: ${handsBack} };`,
        `"a,b".split(pattern).length`,
      ],
      () => [
        `const list = [7, 8];\nlist.constructor = { [Symbol.species]: ${handsBack} };`,
        `list.${random.pick(["map(each => each)", "filter(() => true)", "slice(0)", "splice(0, 1)", "concat([9])", "flat()", "flatMap(each => [each])"])}.length`,
      ],
      () => [`const maker = ${handsBack};`, `Array.from.call(maker, [7, 8]).length`],
      () => [`const maker = ${handsBack};`, `Array.of.call(maker, 7, 8).length`],
      () => [
        "",
        `Array.prototype.${random.pick(["push.call(held, 7)", "unshift.call(held, 7)", "pop.call(held)", "shift.call(held)", "reverse.call(held).length", "fill.call(held, 7).length", "splice.call(held, 0, 1, 7, 8).length", "sort.call(held).length", "copyWithin.call(held, 0, 1).length"])}`,
      ],
      () => [
        `held.exec = () => null;\nheld.flags = "g";`,
        `RegExp.prototype[Symbol.${random.pick(["match", "replace", "search"])}].call(held, "a", "b")`,
      ],
      () => ["", `Object.keys(Object.assign(held, { added: ${value()}, a: ${value()} })).length`],
      () => [
        "",
        `Object.keys(Object.defineProperties(held, { added: { value: ${value()}, enumerable: true, configurable: true } })).length`,
      ],
      () => [
        "",
        `Reflect.${random.pick([`set(held, "added", ${value()})`, `defineProperty(held, "added", { value: ${value()}, enumerable: true })`, 'deleteProperty(held, "a")', `set({}, "added", ${value()}, held)`])}`,
      ],
      () => ["", `Object.entries({ added: 1, a: 2 }).forEach(function ([name, each]) {\nthis[name] = each;\n}, held)`],
      () => [
        "",
        `JSON.parse('{"k":1}', function (name, each) {\nif (name === "k") held.added = this.k;\nreturn each;\n}).k`,
      ],
    ])();
    const look = random.pick([
      "held.lastIndex",
      "typeof held.lastIndex",
      "held.added",
      "held.a",
      "typeof held.added",
      "typeof held.a",
      'held["added"]',
      '"added" in held',
      'Object.keys(held).join("+")',
      "held.length",
      "held[0]",
      "JSON.stringify(held)",
      "held.inherited",
    ]);
    const itselfWrites = random.chance(isKeptClose ? 0.7 : 0.5);
    const call = itselfWrites ? writes : `(${trigger})`;
    const looked = random.pick(
      !itselfWrites
        ? ["held.added", "held.a", "held.added", "held.a", "held[0]", "held.length"]
        : /split|Symbol\./.test(writes)
          ? ["held.lastIndex"]
          : /added/.test(writes)
            ? ["held.added", "held.a"]
            : ["held[0]", "held.length", "held[1]"],
    );
    rows.push(
      `await (async function scene${id}() {\nnote("scene ${id}: ${kind}");\nlet calls = 0;\n${declared.replace("CHANGE_THIS", change("this"))}\n${setup}\n${isKeptClose ? `note("ahead", typeof held.a, typeof held.added, typeof held[0], held.length);` : `const early = () => [held.a, held.added, held[0], held.length];\nnote("ahead", held.a, held.added, held[0], held.length, early(), elsewhere(held)${hasMethods ? ", held.read()" : ""});`}\ntry {\n${itselfWrites ? ahead : ""}\n${random.pick([`note("in one sum", ${call} + typeof ${looked});`, `note("in one sum", ${call} + " " + ${looked});`, `note("in one template", \`\${${call}} \${${looked}} \${typeof ${looked}}\`);`, `note("on both sides", typeof ${looked} + ${call} + typeof ${looked});`, `note("in one comparison", ${call} === ${looked}, ${looked});`, `note("in one expression", [held.a, ${trigger}, ${look}, held.a, held.added]);`, `note("in one expression", String(${trigger}) + " " + String(${look}));`, `const before = held.a;\nconst answer = ${trigger};\nnote("behind", before, answer, ${look});`, `for (let turn = 0; turn < 3; turn++) note("turn", turn, held.a, held.added, ${trigger}, ${look});`])}\n} catch (error) {\nnote("THROWS", error.constructor.name);\n}\nnote("calls", calls);\nnote("the next statement", held.a, held.added, typeof held.added, held[0], held.length, held.lastIndex, "added" in held, "a" in held);\nnote("listed", Object.keys(held).join("+"));\n${isKeptClose ? "" : `note("whole", JSON.stringify(held), held);\nnote("another function", elsewhere(held));\nnote("a closure made ahead", early());\n${hasMethods ? `note("a method", held.read?.());\n` : ""}`}{\nconst { a, added, ...rest } = held;\nconst names = [];\nfor (const name in held) names.push(name);\nnote("taken apart", a, added, Object.keys(rest).join("+"), names.join("+"));\n}\n})();`,
    );
  }
  // There the lines are printed at once, by `console.log` itself or by a function of one line.
  if (isKeptClose) {
    const text = rows.join("\n");
    return random.chance(0.5)
      ? `${small}${text}\n`
      : `const other = { inherited: "from the other prototype" };\n${text.replace(/\bnote\(/g, "console.log(")}\n`;
  }
  return `${head}${rows.join("\n")}\n`;
}

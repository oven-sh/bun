// Small programs about one call in the tail of a function of the program that a built-in calls: `return target(..)` with more, fewer or as many arguments as the function itself was handed. The target
// gets exactly what is written, the built-in gets the answer, and the variables of the function round the built-in are what they were. There is one scene, and every line is printed at once.
//
//   who calls     getters, setters, `valueOf`, `toString`, `toJSON`, `Symbol.toPrimitive`, iterators, traps of a proxy, callbacks of the methods of lists, typed arrays, maps, sets and texts,
//                 comparators, mappers, replacers, revivers, `Reflect.apply`, `call`, `apply`, bound functions, tags, `Symbol.hasInstance`, `using`
//   the tail      `target(..)`, `call`, `apply`, a spread, a method, either arm of a condition, the far side of `&&` and of a comma; none to twenty arguments
//   the target    takes a rest, fixed parameters, defaults, reads `arguments`; answers at once, calls on in its own tail with another number of arguments, a thousand times, runs a collection,
//                 makes an error and counts nothing of it, throws
//   then          what the target was handed, what the built-in answered, the variables round the call
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const count = random.pick([0, 1, 2, 3, 5, 8, 13, 20]);
  const list = Array.from({ length: count }, (_, index) =>
    random.pick([`${index + 1}`, `${index + 1}`, `"a${index + 1}"`, `${index + 1}.5`]),
  ).join(", ");
  const tail = random.weighted([
    [6, `return target(${list});`],
    [2, `return target.call(null${list ? ", " + list : ""});`],
    [2, `return target.apply(null, [${list}]);`],
    [2, `return target(...[${list}]);`],
    [2, `return holder.target(${list});`],
    [1, `return log.length >= 0 ? target(${list}) : target();`],
    [1, `return log && target(${list});`],
    [1, `return log.length, target(${list});`],
    [1, `return (0, target)(${list});`],
    [1, `return Reflect.apply(target, null, [${list}]);`],
  ]);
  const B = tail;
  const answer = random.pick(["1", "1", '"k"', "0", "undefined"]);
  const notes = random.pick([
    'log.push(all.length + ":" + all.join());',
    'log.push(all.length + ":" + all.join());',
    'log.push(all.length + ":" + all.at(0) + ":" + all.at(-1));',
  ]);
  const target = random.weighted([
    [5, `function target(...all) {\n${notes}\nreturn ${answer};\n}`],
    [2, `function target(a, b, c) {\nlog.push(arguments.length + ":" + a + ":" + b + ":" + c);\nreturn ${answer};\n}`],
    [
      2,
      `function target(a = "da", b = "db", ...all) {\nlog.push(a + ":" + b + ":" + all.length);\nreturn ${answer};\n}`,
    ],
    [
      2,
      `function target() {\nlog.push(arguments.length + ":" + Array.prototype.join.call(arguments));\nreturn ${answer};\n}`,
    ],
    [
      3,
      `function target(...all) {\n${notes}\nreturn further(all.length, "x", "y", "z", 5, 6, 7, 8, 9);\n}\nfunction further(...all) {\n${notes}\nreturn last();\n}\nfunction last(...all) {\n${notes}\nreturn ${answer};\n}`,
    ],
    [
      2,
      `function target(...all) {\n${notes}\nreturn down(1000, 1, 2, 3);\n}\nfunction down(n, a, b, c, d) {\nif (n === 0) return ${answer};\nreturn n % 2 ? down(n - 1, a) : down(n - 1, a, b, c, n);\n}`,
    ],
    [3, `function target(...all) {\nBun.gc(true);\n${notes}\nreturn ${answer};\n}`],
    [
      2,
      `function target(...all) {\nconst made = new Error("made");\nlog.push(typeof made.stack + ":" + all.length);\nreturn ${answer};\n}`,
    ],
    [2, `function target(...all) {\n${notes}\nthrow new RangeError("thrown by the target");\n}`],
    [1, `function target(...all) {\n${notes}\nreturn atob("***");\n}`],
  ]);

  const callers: [number, string][] = [
    [3, `Object.assign({}, {\nget value() {\n${B}\n},\n});`],
    [2, `Object.assign(\n{\nset value(given) {\n${B}\n},\n},\n{ value: 1 },\n);`],
    [2, `Object.defineProperty({}, "k", {\nget value() {\n${B}\n},\n});`],
    [1, `Object.defineProperties({}, {\nk: {\nget value() {\n${B}\n},\n},\n});`],
    [1, `Object.entries({\nget value() {\n${B}\n},\n});`],
    [1, `Object.values({\nget value() {\n${B}\n},\n});`],
    [1, `({\n...{\nget value() {\n${B}\n},\n},\n});`],
    [1, `structuredClone({\nget value() {\n${B}\n},\n});`],
    [1, `Object.fromEntries({\n*[Symbol.iterator]() {\n${B}\n},\n});`],
    [3, `JSON.stringify({\ntoJSON() {\n${B}\n},\n});`],
    [2, `JSON.stringify({\nget value() {\n${B}\n},\n});`],
    [2, `JSON.stringify({ k: 1 }, () => {\n${B}\n});`],
    [2, `JSON.parse("[1]", () => {\n${B}\n});`],
    [3, `Math.max({\nvalueOf() {\n${B}\n},\n});`],
    [1, `Number({\nvalueOf() {\n${B}\n},\n});`],
    [1, `new Date({\nvalueOf() {\n${B}\n},\n});`],
    [1, `[1, 2].at({\nvalueOf() {\n${B}\n},\n});`],
    [1, `"xy".slice({\nvalueOf() {\n${B}\n},\n});`],
    [2, `String({\ntoString() {\n${B}\n},\n});`],
    [1, `[\n{\ntoString() {\n${B}\n},\n},\n].join();`],
    [1, `"k".includes({\ntoString() {\n${B}\n},\n});`],
    [1, `new RegExp({\ntoString() {\n${B}\n},\n});`],
    [1, `({})[\n{\ntoString() {\n${B}\n},\n}\n];`],
    [1, `parseInt({\ntoString() {\n${B}\n},\n});`],
    [1, `new Error({\ntoString() {\n${B}\n},\n});`],
    [2, `\`\${{\n[Symbol.toPrimitive]() {\n${B}\n},\n}}\`;`],
    [1, `+{\n[Symbol.toPrimitive]() {\n${B}\n},\n};`],
    [2, `[2, 1].sort(() => {\n${B}\n});`],
    [1, `[2, 1].toSorted(() => {\n${B}\n});`],
    [2, `[1].map(() => {\n${B}\n});`],
    [1, `[1].forEach(() => {\n${B}\n});`],
    [1, `[1].filter(() => {\n${B}\n});`],
    [1, `[1, 2].reduce(() => {\n${B}\n});`],
    [1, `[1].find(() => {\n${B}\n});`],
    [1, `[1].some(() => {\n${B}\n});`],
    [1, `[1].flatMap(() => {\n${B}\n});`],
    [1, `[1].findLast(() => {\n${B}\n});`],
    [1, `Object.groupBy([1], () => {\n${B}\n});`],
    [2, `Array.from([1], () => {\n${B}\n});`],
    [1, `Array.from({\n*[Symbol.iterator]() {\n${B}\n},\n});`],
    [1, `Array.from({\nget length() {\n${B}\n},\n});`],
    [1, `new Uint8Array([2, 1]).sort(() => {\n${B}\n});`],
    [1, `new Uint8Array([1]).map(() => {\n${B}\n});`],
    [1, `new Map([[1, 1]]).forEach(() => {\n${B}\n});`],
    [1, `new Set([1]).forEach(() => {\n${B}\n});`],
    [1, `new Map({\n*[Symbol.iterator]() {\n${B}\n},\n});`],
    [1, `new Set({\n[Symbol.iterator]() {\nreturn {\nnext() {\n${B}\n},\n};\n},\n});`],
    [1, `Math.max(\n...{\n*[Symbol.iterator]() {\n${B}\n},\n},\n);`],
    [
      1,
      `for (const each of {\n[Symbol.iterator]() {\nreturn {\nnext() {\nreturn { done: false, value: 1 };\n},\nreturn() {\n${B}\n},\n};\n},\n})\nbreak;`,
    ],
    [2, `"x".replace("x", () => {\n${B}\n});`],
    [1, `"x".replace(/x/g, () => {\n${B}\n});`],
    [1, `"x".replaceAll("x", () => {\n${B}\n});`],
    [1, `"x".replace(\n{\n[Symbol.replace]() {\n${B}\n},\n},\n"",\n);`],
    [1, `"x".split({\n[Symbol.split]() {\n${B}\n},\n});`],
    [2, `Reflect.apply(\nfunction () {\n${B}\n},\nnull,\n[],\n);`],
    [1, `(function () {\n${B}\n}).call(null);`],
    [1, `(function () {\n${B}\n}).apply(null, []);`],
    [1, `(function () {\n${B}\n}).bind(null)();`],
    [1, `Reflect.construct(function () {\n${B}\n}, []);`],
    [2, `new Proxy(\n{},\n{\nget() {\n${B}\n},\n},\n).k;`],
    [1, `"k" in\nnew Proxy(\n{},\n{\nhas() {\n${B}\n},\n},\n);`],
    [1, `Object.keys(\nnew Proxy(\n{},\n{\nownKeys() {\n${B}\n},\n},\n),\n);`],
    [1, `new Proxy(\n{},\n{\nset() {\n${B}\n},\n},\n).k = 1;`],
    [1, `new Proxy(function () {}, {\napply() {\n${B}\n},\n})();`],
    [1, `JSON.stringify(\nnew Proxy(\n{ k: 1 },\n{\nget() {\n${B}\n},\n},\n),\n);`],
    [1, `(function (texts) {\n${B}\n})\`x\`;`],
    [1, `1 instanceof\n{\n[Symbol.hasInstance]() {\n${B}\n},\n};`],
    [1, `{\nusing held = {\n[Symbol.dispose]() {\n${B}\n},\n};\n}`],
    [1, `[].concat({\nget [Symbol.isConcatSpreadable]() {\n${B}\n},\n});`],
    [1, `Object.prototype.toString.call({\nget [Symbol.toStringTag]() {\n${B}\n},\n});`],
    [1, `Bun.inspect({\nget value() {\n${B}\n},\n});`],
    [1, `Bun.deepEquals(\n{\nget value() {\n${B}\n},\n},\n{ value: 1 },\n);`],
    [1, `(() => {\n${B}\n})();`],
  ];

  const call = random.weighted(callers);
  const scene = [
    'const kept = [1, "t", 2.5];',
    "const x = 11;",
    'const y = "why";',
    `try {\n${call}\nlog.push("answered");\n} catch (error) {\nlog.push("caught " + (error?.constructor?.name ?? String(error)));\n}`,
    'console.log(log.join(" | "), x, y, kept.join());',
  ].join("\n");
  const head = [
    '"use strict";',
    "const log = [];",
    target,
    tail.includes("holder.") ? "const holder = { target };" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const where = random.pick(["top", "once", "once", "thrice"] as const);
  if (where === "top") return { file, text: `${head}\n${scene}\n` };
  return {
    file,
    text: `${head}\nfunction run() {\n${scene}\n}\n${where === "once" ? "run();" : "run();\nrun();\nrun();"}\n`,
  };
}

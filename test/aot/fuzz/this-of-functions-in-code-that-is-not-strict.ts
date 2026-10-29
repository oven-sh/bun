// A CommonJS file that is not strict declares functions that store into `this`, read it and hand it on. They are constructed, called plainly, called
// with undefined, null, a number, a text, a boolean, a symbol, a bigint or an object as `this`, used as methods and as callbacks of built-in
// functions, and stand above one another. The way may change in a late turn of a loop. What they made and what reached the global object is printed.
import type { Random } from "./random";

const names = [`a`, `b`, `c`, `shared`, `length`, `name`, `0`, `toString`] as const;
const values = [
  `given`,
  `1`,
  `1.5`,
  `"text"`,
  `[given]`,
  `{ inner: given }`,
  `() => given`,
  `this`,
  `undefined`,
  `typeof this`,
  `turn`,
] as const;

const ways = [
  `new F(turn)`,
  `new F(turn)`,
  `F(turn)`,
  `F.call(undefined, turn)`,
  `F.call(null, turn)`,
  `F.call(7, turn)`,
  `F.call("text", turn)`,
  `F.call(true, turn)`,
  `F.call(Symbol.iterator, turn)`,
  `F.call(10n, turn)`,
  `F.call({ own: 1 }, turn)`,
  `F.call(target, turn)`,
  `F.apply(target, [turn])`,
  `Reflect.apply(F, target, [turn])`,
  `Reflect.apply(F, undefined, [turn])`,
  `Reflect.construct(F, [turn])`,
  `Reflect.construct(F, [turn], Other)`,
  `F.bind(target)(turn)`,
  `F.bind(5)(turn)`,
  `new (F.bind(target))(turn)`,
  `({ F }).F(turn)`,
  `[turn].map(F)[0]`,
  `[turn].map(F, target)[0]`,
  `[turn].map(F, 3)[0]`,
  `(0, F)(turn)`,
  `unknown(F)(turn)`,
  `F.call(Object.create(F.prototype), turn)`,
  `F.call(Object.freeze({ a: 0 }), turn)`,
] as const;

function pick<T>(random: Random, list: readonly T[]): T {
  return list[random.below(list.length)];
}

function member(name: string): string {
  return /^\d/.test(name) ? `[${name}]` : `.${name}`;
}

export function generate(random: Random, isStrict = false): string {
  const lines = [
    isStrict ? `"use strict";` : `// This file is not strict.`,
    `const unknown = globalThis[["Obj", "ect"].join("")];`,
    `const before = new Set(Object.getOwnPropertyNames(globalThis));`,
    `const target = { isTarget: true };`,
    `function Other() {}`,
    `function told(value) {\nif (value === globalThis) return "the global object";\nif (value === target) return "the target " + Object.keys(value).join();\nif (typeof value === "function") return "function";\nif (typeof value === "symbol" || typeof value === "bigint") return typeof value;\nif (typeof value !== "object" || value === null) return typeof value + " " + String(value);\nlet text = Object.prototype.toString.call(value) + " " + (Object.getPrototypeOf(value)?.constructor?.name ?? "none") + " {";\nfor (const key of Object.keys(value)) {\nconst held = value[key];\ntext += " " + key + ": " + (held === value ? "itself" : held === globalThis ? "the global object" : typeof held === "object" && held !== null ? "object" : typeof held === "function" ? "function" : typeof held === "symbol" ? "symbol" : String(held));\n}\nreturn text + " }";\n}`,
    `function sweep(label) {\nconst added = Object.getOwnPropertyNames(globalThis).filter(key => !before.has(key)).sort();\nif (added.length > 0) console.log(label, "on the global object:", added.map(key => key + " " + typeof globalThis[key]).join(", "));\nfor (const key of added) delete globalThis[key];\n}`,
  ];
  const count = random.between(1, 4);
  for (let row = 0; row < count; row++) {
    const body: string[] = [];
    if (random.chance(0.2)) body.push(`if (!(this instanceof F${row})) return new F${row}(given);`);
    if (row > 0 && random.chance(0.35))
      body.push(
        pick(random, [`F${row - 1}.call(this, given);`, `F${row - 1}.apply(this, arguments);`, `F${row - 1}(given);`]),
      );
    for (let store = random.between(1, 4); store > 0; store--) {
      const name = pick(random, names);
      const text = `this${member(name)} = ${pick(random, values)};`;
      body.push(
        random.chance(0.2)
          ? `if (given % 3 === 0) ${text}`
          : random.chance(0.15)
            ? `try {\n${text}\n} catch (error) {\nfailed++;\n}`
            : text,
      );
    }
    if (random.chance(0.3)) body.push(`helper${row}.call(this, given);`);
    if (random.chance(0.3))
      body.push(`seen = typeof this + " " + (this === globalThis) + " " + (this instanceof F${row});`);
    if (random.chance(0.2)) body.push(`const self = this;\nthis.again = function () {\nreturn self === this;\n};`);
    body.push(
      pick(random, [
        ``,
        ``,
        `return this;`,
        `return this${member(pick(random, names))};`,
        `return given;`,
        `return { made: given };`,
        `return typeof this;`,
      ]),
    );
    lines.push(`let seen = "";\nlet failed = 0;`.replaceAll(`seen`, `seen${row}`).replaceAll(`failed`, `failed${row}`));
    lines.push(`function helper${row}(given) {\nthis.helped = given;\n}`);
    lines.push(
      `function F${row}(given) {\n${body.filter(Boolean).join("\n")}\n}`
        .replaceAll(`seen =`, `seen${row} =`)
        .replaceAll(`failed++`, `failed${row}++`)
        .replace(/\bturn\b/g, `given`),
    );
    if (row > 0 && random.chance(0.5))
      lines.push(
        random.chance(0.3)
          ? `require("node:util").inherits(F${row}, F${row - 1});`
          : `F${row}.prototype = Object.create(F${row - 1}.prototype);\nF${row}.prototype.constructor = F${row};`,
      );
    if (random.chance(0.4))
      lines.push(
        `F${row}.prototype.set = function (value) {\nthis${member(pick(random, names))} = value;\nreturn this;\n};`,
      );
    if (random.chance(0.3)) lines.push(`F${row}.prototype.shared = "from the prototype";`);
    if (random.chance(0.15))
      lines.push(
        `Object.defineProperty(F${row}.prototype, "a", {\nset(value) {\nthis.stored = value;\n},\nget() {\nreturn "got";\n},\n});`,
      );
    const turns = pick(random, [1, 2, 50, 300]);
    const first = pick(random, ways).replaceAll(`F`, `F${row}`).replaceAll(`ReF${row}lect`, `Reflect`);
    const late = pick(random, ways).replaceAll(`F`, `F${row}`).replaceAll(`ReF${row}lect`, `Reflect`);
    lines.push(
      `for (let turn = 0; turn < ${turns}; turn++) {\nlet answer;\ntry {\nanswer = turn === ${turns - 1} ? ${late} : ${first};\n} catch (error) {\nanswer = "threw " + error?.constructor?.name;\n}\ntry {\nif (typeof answer?.set === "function" && turn % 2 === 0) answer = answer.set(turn);\n} catch (error) {\nanswer = "set threw " + error?.constructor?.name;\n}\nif (turn === 0 || turn >= ${turns - 2}) {\nconsole.log("${row}", turn, told(answer), "|", seen${row}, failed${row});\nconsole.log("${row} bare", typeof a, typeof shared, typeof helped);\n}\nsweep("${row} " + turn);\n}`,
    );
    lines.push(`console.log("${row} target", told(target));`);
  }
  return lines.join("\n") + "\n";
}

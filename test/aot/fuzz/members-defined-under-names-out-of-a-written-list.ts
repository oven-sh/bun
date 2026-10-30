// Methods, getters and setters are defined under names that come out of a written list of texts: in a for-of loop, in forEach, map or reduce, over a
// constant of the module that may change between two loops, by index, or through a function that takes the name. Names repeat, a turn is left early,
// throws or is nested in a loop or a function that runs many times, the callback is kept and called with other values. The members are then called,
// read through an heir, defined again and deleted. Closures made in loops capture one text, number, boolean, undefined or null.
import type { Random } from "./random";

const pool = [
  `get`,
  `put`,
  `del`,
  `head`,
  `on`,
  `off`,
  `a`,
  `b`,
  `constructor`,
  `toString`,
  `0`,
  `__proto__`,
  `length`,
  `name`,
  `valueOf`,
  `two words`,
] as const;
const targets = [
  `{}`,
  `function () {}`,
  `class {}.prototype`,
  `Object.create(null)`,
  `[]`,
  `Object.create({ get: "inherited" })`,
  `new (class {\nget = "a field";\n})()`,
] as const;

const definitions = [
  `target[name] = function (given) {\nreturn name + ":" + given;\n};`,
  `target[name] = given => [name, given].join();`,
  `Object.defineProperty(target, name, {\nget() {\nreturn "got " + name;\n},\nconfigurable: true,\n});`,
  `Object.defineProperty(target, name, {\nset(value) {\nlog.push(name + "=" + (typeof value === "function" ? "function" : value));\n},\nconfigurable: true,\n});`,
  `target[name] = function () {\nreturn this === target ? name : typeof this;\n};`,
  `define(target, name);`,
  `target["on" + name] = () => name.length;`,
  `target[name.toUpperCase()] = () => name;`,
  `Object.assign(target, {\n[name]() {\nreturn name;\n},\n});`,
  `target[name] = { [name]: () => name }[name];`,
  `target[name] = function () {\nreturn target[name] === undefined ? "gone" : name + count++;\n};`,
  `target[name] = name;`,
] as const;

function pick<T>(random: Random, list: readonly T[]): T {
  return list[random.below(list.length)];
}

export function generate(random: Random): string {
  const lines = [
    `const log = [];`,
    `let count = 0;`,
    `function define(target, name) {\ntarget[name] = function (given) {\nreturn "defined " + name + " " + given;\n};\n}`,
    `function told(run) {\ntry {\nconst value = run();\nreturn typeof value === "function" ? "function " + value.name : typeof value === "object" && value !== null ? "object" : String(value);\n} catch (error) {\nreturn "threw " + error?.constructor?.name;\n}\n}`,
    `function show(label, target) {\nfor (const key of Reflect.ownKeys(target).map(String).sort()) {\nconst own = Object.getOwnPropertyDescriptor(target, key);\nconsole.log(label, key, own.get ? "getter" : own.set ? "setter" : typeof own.value, told(() => target[key]), told(() => target[key](1)), told(() => (0, target[key])(2)), told(() => Object.create(target)[key]), told(() => Object.create(target)[key](3)));\n}\n}`,
  ];
  const count = random.between(1, 4);
  for (let row = 0; row < count; row++) {
    const list = Array.from({ length: random.between(1, 7) }, () => pick(random, pool));
    if (random.chance(0.3)) list.push(list[0]);
    const written = `[${list.map(name => JSON.stringify(name)).join(", ")}]`;
    const one = JSON.stringify(pick(random, list));
    const isLoop = random.chance(0.45);
    const leave = isLoop ? pick(random, [`continue;`, `break;`]) : `return 0;`;
    let turn = pick(random, definitions);
    if (random.chance(0.25)) turn += `\n` + pick(random, definitions);
    if (random.chance(0.25)) turn = `if (name === ${one}) ${leave}\n${turn}`;
    else if (random.chance(0.2)) turn = `${turn}\nif (name === ${one}) ${leave}`;
    else if (random.chance(0.2))
      turn = `try {\nif (name === ${one}) throw new Error(name);\n${turn}\n} catch (error) {\nlog.push("caught " + (error instanceof TypeError ? "TypeError" : error.message));\n}`;
    const change = pick(random, [
      ``,
      ``,
      `names${row}.push("late");`,
      `names${row}[0] = "changed";`,
      `names${row}.length = 1;`,
      `names${row}.reverse();`,
    ]);
    const spelled = isLoop
      ? pick(random, [
          `for (const name of ${written}) {\n${turn}\n}`,
          `for (const name of ${written}) {\n${turn}\n}`,
          `for (const name of names${row}) {\n${turn}\n}\n${change}\nfor (const name of names${row}) {\n${turn}\n}`,
          `for (let index = 0; index < names${row}.length; index++) {\nconst name = names${row}[index];\n${turn}\n}`,
          `for (const name in { ${list.map(name => `[${JSON.stringify(name)}]: 1`).join(", ")} }) {\n${turn}\n}`,
        ])
      : pick(random, [
          `${written}.forEach(name => {\n${turn}\n});`,
          `${written}.forEach(function (name, index) {\n${turn}\n});`,
          `${written}.map(name => {\n${turn}\nreturn name;\n});`,
          `${written}.reduce((sum, name) => {\n${turn}\nreturn sum + 1;\n}, 0);`,
          `names${row}.forEach(name => {\n${turn}\n});\n${change}\nnames${row}.forEach(name => {\n${turn}\n});`,
          `const each = name => {\n${turn}\n};\n${written}.forEach(each);\neach("other");\ntold(() => each(7));\ntold(() => each(undefined));\nkept.push(each);`,
        ]);
    lines.push(`const names${row} = ${written};`, `const kept = [];`.replace(`kept`, `kept${row}`));
    const body = `try {\n${spelled.replaceAll(`kept.push`, `kept${row}.push`)}\n} catch (error) {\nlog.push("left by " + error?.constructor?.name);\n}`;
    const nested = random.below(4);
    if (nested === 0)
      lines.push(`const target${row} = ${pick(random, targets)};\n{\nconst target = target${row};\n${body}\n}`);
    else if (nested === 1)
      lines.push(
        `const target${row} = ${pick(random, targets)};\nfor (let round = 0; round < ${pick(random, [2, 50, 400])}; round++) {\nconst target = target${row};\n${body}\n}`,
      );
    else
      lines.push(
        `function setUp${row}() {\nconst target = ${pick(random, targets)};\n${body}\nreturn target;\n}\nlet target${row};\nfor (let round = 0; round < ${pick(random, [1, 3, 300])}; round++) target${row} = setUp${row}();`,
      );
    lines.push(`show("${row}", target${row});`);
    for (let step = random.between(0, 3); step > 0; step--)
      lines.push(
        pick(random, [
          `told(() => delete target${row}[${one}]);`,
          `told(() => (target${row}[${one}] = () => "stored again"));`,
          `told(() => Object.defineProperty(target${row}, ${one}, { value: "defined again", configurable: true }));`,
          `for (const each of kept${row}) told(() => each("later"));`,
          `told(() => (target${row}[${one}] = 5));`,
          `told(() => Object.freeze(target${row}));`,
        ]),
        `show("${row} then", target${row});`,
      );
  }
  const captured = Array.from({ length: random.between(1, 6) }, () =>
    pick(random, [`"text"`, `""`, `1`, `1.5`, `-0`, `true`, `false`, `undefined`, `null`, `NaN`, `2147483648`]),
  );
  lines.push(
    `const closures = [];`,
    pick(random, [
      `for (const value of [${captured.join(", ")}]) closures.push(() => value);`,
      `[${captured.join(", ")}].forEach(value => closures.push(() => value));`,
      `for (let round = 0; round < ${pick(random, [1, 100])}; round++) for (const value of [${captured.join(", ")}]) closures[closures.length % 16] = () => [value, round % 2];`,
      `for (let value = 0; value < 4; value++) {\nclosures.push(() => value);\nif (value === 1) value++;\n}`,
    ]),
    `console.log(closures.map(closure => JSON.stringify(closure()) + " " + Object.is(closure(), -0)).join(" | "));`,
    `console.log(log.length, log.slice(0, 40).join(), count);`,
  );
  return lines.join("\n") + "\n";
}

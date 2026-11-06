// Lists, plain objects, instances of classes and of classes below Array take elements by index. At some time an object above them begins to
// intercept such stores: a Proxy is hung into the chain, or an index gets a setter or a value that cannot be written on a prototype of the
// program. Objects are made before and behind that time, collections run in between, and classes are
// made by the hundred. Each store, read and test writes down what it saw, and so does each interceptor.
import type { Random } from "./random";

const makers = [
  `() => []`,
  `() => [1, 2]`,
  `() => [1.5, 2.5]`,
  `() => ["s", {}]`,
  `() => [, 1]`,
  `() => new Array(3)`,
  `() => Array.from({ length: 2 }, (_, index) => index)`,
  `() => ({})`,
  `() => ({ 0: "a", 1: "b" })`,
  `() => ({ name: "n", 0: "a" })`,
  `() => new Plain(1)`,
  `() => new Below(2)`,
  `() => new List()`,
  `() => List.of(1, 2)`,
  `() => Object.create(above)`,
  `() => Object.create(Plain.prototype)`,
  `() => Object.assign(Object.create(above), { 0: "own" })`,
  `() => (function () {\nreturn arguments;\n})(1, 2)`,
  `() => function () {}`,
  `() => Object.create(null)`,
  `() => new (class extends Plain {})(3)`,
  `() => [1, 2].map(value => value)`,
  `() => JSON.parse("[1,2]")`,
  `() => JSON.parse('{"0":1,"k":2}')`,
] as const;

const places = [`above`, `Plain.prototype`, `Below.prototype`, `List.prototype`] as const;

const installs = [
  (place: string, index: number) =>
    `Object.defineProperty(${place}, "${index}", {\nset(value) {\nsay("setter ${index} of ${place} " + show(value));\n},\nget() {\nreturn "got ${index}";\n},\nconfigurable: true,\n});`,
  (place: string, index: number) => `Object.defineProperty(${place}, "${index}", { value: "fixed ${index}", writable: false, configurable: true });`,
  (place: string, index: number) => `${place}[${index}] = "inherited ${index}";`,
  (place: string, index: number) => `Object.defineProperty(${place}, "${index}", { get: () => "only a getter", configurable: true });`,
] as const;

const proxied = [`above`, `Plain.prototype`, `List.prototype`] as const;

const acts = [
  (index: number) => `for (const target of made) store(target, ${index}, "v${index}");`,
  (index: number) => `for (const target of made) store(target, ${index}, ${index}.5);`,
  (index: number) => `for (const target of made) store(target, "${index}", ${index});`,
  (index: number) => `for (const target of made) say(attempt(() => show(target[${index}])));`,
  (index: number) => `for (const target of made) say(attempt(() => ${index} in target));`,
  (index: number) => `for (const target of made) if (Array.isArray(target)) say(attempt(() => target.push("p")));`,
  (index: number) => `for (const target of made) if (Array.isArray(target)) say(attempt(() => target.fill("f", 0, ${index}).length));`,
  (index: number) => `for (const target of made) if (Array.isArray(target)) say(attempt(() => show([...target])));`,
  (index: number) => `for (const target of made) if (Array.isArray(target)) say(attempt(() => show(target.concat([${index}]))));`,
  (index: number) => `for (const target of made) if (Array.isArray(target)) say(attempt(() => ((target.length = ${index}), target.length)));`,
  (index: number) => `for (const target of made) say(attempt(() => Object.keys(target).join()));`,
  (index: number) => `for (const target of made) say(attempt(() => delete target[${index}]));`,
  (index: number) => `for (const target of made) say(attempt(() => Reflect.set(target, ${index}, "r")));`,
  (index: number) => `for (const target of made) say(attempt(() => (Object.defineProperty(target, ${index}, { value: "d", writable: true, configurable: true, enumerable: true }), show(target[${index}]))));`,
  (index: number) => `for (const target of made) {\nlet keys = "";\nfor (const key in target) keys += key + ",";\nsay(keys);\n}`,
] as const;

function pick<T>(random: Random, list: readonly T[]): T {
  return list[random.below(list.length)];
}

export function generate(random: Random): string {
  const lines = [
    ...(random.chance(0.4) ? [`"use strict";`] : []),
    `const out = ["0", "1", "2", "3", "4", "5", "6", "7"];`,
    `function say(line) {\nout.push(String(line));\n}`,
    `function show(value) {\ntry {\nreturn typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);\n} catch (error) {\nreturn error.name;\n}\n}`,
    `function attempt(run) {\ntry {\nreturn run();\n} catch (error) {\nreturn "threw " + error.name;\n}\n}`,
    `function store(target, index, value) {\ntry {\ntarget[index] = value;\nsay(show(target[index]) + " " + Object.hasOwn(target, index));\n} catch (error) {\nsay("threw " + error.name);\n}\n}`,
    `const above = { named: 1 };`,
    `class Plain {\nconstructor(n) {\nthis.n = n;\nthis[0] = n;\n}\n}`,
    `class Below extends Plain {\nconstructor(n) {\nsuper(n);\nthis[1] = n;\n}\n}`,
    `class List extends Array {}`,
    `function intercept(name) {\nreturn new Proxy(\n{},\n{\nset(target, key, value, receiver) {\nsay("set " + String(key) + " through " + name);\nreturn Reflect.set(target, key, value, receiver);\n},\nget(target, key, receiver) {\nif (typeof key === "string" && /^\\d+$/.test(key)) say("get " + key + " through " + name);\nreturn Reflect.get(target, key, receiver);\n},\nhas(target, key) {\nsay("has " + String(key) + " through " + name);\nreturn Reflect.has(target, key);\n},\n},\n);\n}`,
    `const made = [];`,
    `const undo = [];`,
  ];
  const chosen = Array.from({ length: random.between(2, 6) }, () => pick(random, makers));
  lines.push(`const makers = [\n${chosen.join(",\n")},\n];`);
  const steps = random.between(5, 16);
  for (let step = 0; step < steps; step++) {
    const way = random.below(20);
    const index = random.below(7);
    if (way < 4) lines.push(`for (const make of makers) attempt(() => made.push(make()));`);
    else if (way < 11) lines.push(pick(random, acts)(index));
    else if (way < 14) {
      const place = pick(random, places);
      lines.push(pick(random, installs)(place, index), `undo.push(() => delete ${place}[${index}]);`);
    } else if (way < 16) {
      const place = pick(random, proxied);
      lines.push(`say(attempt(() => (Object.setPrototypeOf(${place}, intercept("${place} ${step}")), "hung")));`);
    } else if (way === 16) lines.push(`Bun.gc(true);`);
    else if (way === 17)
      lines.push(
        `for (let count = 0; count < ${pick(random, [3, 50, 400])}; count++) {\nclass Many {\nconstructor() {\nthis[0] = count;\n}\n}\nif (count % ${pick(random, [1, 2, 7])} === 0) Object.setPrototypeOf(Many.prototype, intercept("many"));\nconst one = attempt(() => new Many());\nif (count < 2) made.push(one);\nout.length = Math.min(out.length, 4000);\n}`,
      );
    else if (way === 18) lines.push(`for (let round = 0; round < 300; round++) for (const make of makers) attempt(() => store(make(), round % 5, round));\nout.length = Math.min(out.length, 4000);`);
    else lines.push(`while (undo.length) attempt(() => undo.pop()());`);
  }
  lines.push(`while (undo.length) attempt(() => undo.pop()());`, `console.log(out.join("\\n"));`, `console.log(out.length, made.length);`);
  return lines.join("\n") + "\n";
}

// A function takes a rest parameter, or a parameter for which its callers write an object or a list, and may return, throw or go on before it
// touches that parameter. What stands in front of the first use has effects; what the caller writes has effects too, and their order shows. Behind
// the first use the value is read, changed, kept, handed on, compared with itself or captured. The switch that decides turns while the program runs.
import type { Random } from "./random";

const starts = [
  `if (!enabled) return;`,
  `if (!enabled) return "off";`,
  `if (!enabled) return say("off"), 0;`,
  `say("in");\nif (!enabled) return;`,
  `calls++;\nif (calls % 3 === 0) return calls;`,
  `if (!enabled) throw new RangeError("off");`,
  `if (level < 1) return;\nif (level < 2) return say("low");`,
  `switch (level) {\ncase 0:\nreturn "zero";\ncase 1:\nsay("one");\nbreak;\ndefault:\nsay("more");\n}`,
  `for (let i = 0; i < level; i++) if (i === 2) return "looped";`,
  `try {\nif (!enabled) return "tried";\n} finally {\nsay("finally");\n}`,
  `if (first === undefined) return "nothing";`,
  `if (typeof first === "number" && first > 2) return first;`,
  `if (arguments.length === 0) return "no arguments";\nif (!enabled) return arguments.length;`,
  `if (this === undefined || !enabled) return "this " + typeof this;`,
  `if (!enabled) {\nBun.gc(true);\nreturn "collected";\n}`,
  `const before = tick();\nif (before & 1) return before;`,
  `if (!enabled) return;\nBun.gc(true);`,
  `if (new.target === undefined && !enabled) return "called";`,
  `if (depth > 0 && !enabled) return depth;`,
  `enabled = !enabled;\nif (enabled) return "turned";`,
  ``,
] as const;

const usesOfAList = [
  `return P.length;`,
  `return P.join();`,
  `return P;`,
  `kept.push(P);\nreturn kept.length;`,
  `return other(...P);`,
  `return other.apply(null, P);`,
  `P.push("more");\nreturn P.length + ":" + P[0];`,
  `return () => P;`,
  `return P === P && Array.isArray(P);`,
  `let sum = "";\nfor (const value of P) sum += typeof value;\nreturn sum;`,
  `const [a, b = "none"] = P;\nreturn String(a) + b;`,
  `return P.map(value => typeof value).join();`,
  `P.length = 0;\nreturn P;`,
  `return Object.freeze(P).length;`,
  `P = ["put in its place"];\nreturn P;`,
  `return P.length < 4 ? NAME(first, ...P, "deeper") : P.length;`,
  `return [P, P];`,
  `return JSON.stringify(P);`,
  `return { held: P };`,
  `return typeof P + P.constructor.name;`,
  `return P[level];`,
  `return P.at(-1);`,
] as const;

const usesOfAnObject = [
  `return P.a;`,
  `return P.a + ":" + P.b;`,
  `return P;`,
  `kept.push(P);\nreturn kept.length;`,
  `return other(P);`,
  `P.a = "stored";\nreturn P.a + P.b;`,
  `return () => P;`,
  `return P === P;`,
  `return Object.keys(P).join();`,
  `const { a, b = "none", ...rest } = P;\nreturn String(a) + b + Object.keys(rest);`,
  `delete P.a;\nreturn "a" in P;`,
  `return Object.freeze(P).b;`,
  `P = { a: "put in its place" };\nreturn P.a;`,
  `return { ...P };`,
  `return JSON.stringify(P);`,
  `return P?.a?.toString();`,
  `return arguments[1] === P;`,
  `arguments[1] = { a: "through arguments" };\nreturn P.a;`,
  `return typeof P + Object.getPrototypeOf(P)?.constructor?.name;`,
  `for (const key in P) say(key);\nreturn 1;`,
  `return P[level ? "a" : "b"];`,
  `return P.m?.();`,
] as const;

const lists = [``, `tick()`, `tick(), tick()`, `"x", 1, null`, `...list`, `tick(), ...list, tick()`, `{ a: tick() }`, `[tick()]`, `() => tick()`, `undefined`, `...[]`, `1, 2, 3, 4, 5, 6, 7, 8, 9`] as const;
const objects = [
  `{ a: 1, b: 2 }`,
  `{ a: tick(), b: tick() }`,
  `{ b: tick(), a: tick() }`,
  `{ a: tick() }`,
  `{}`,
  `{ a: say("a"), b: say("b"), c: say("c") }`,
  `{ [say("key")]: tick(), a: 1 }`,
  `{ ...spread, a: tick() }`,
  `{ get a() {\nreturn say("the getter");\n}, b: 2 }`,
  `{ __proto__: spread, a: 1 }`,
  `{ a: { a: tick() }, b: [tick()] }`,
  `{ a: 1, m() {\nreturn this.a;\n} }`,
  `{ a: () => tick(), b: 2 }`,
  `{ a: 1.5, b: "s" }`,
  `[tick(), tick()]`,
  `shared`,
  `undefined`,
  `null`,
  `7`,
] as const;

function pick<T>(random: Random, list: readonly T[]): T {
  return list[random.below(list.length)];
}

export function generate(random: Random): string {
  const lines = [
    ...(random.chance(0.3) ? [`"use strict";`] : []),
    `let enabled = false;`,
    `let level = 0;`,
    `let calls = 0;`,
    `let ticks = 0;`,
    `const kept = [];`,
    `const out = [];`,
    `const list = [1, "two"];`,
    `const spread = { b: "spread b", z: 26 };`,
    `const shared = { a: "shared a", b: "shared b" };`,
    `function say(line) {\nout.push(line);\nreturn line;\n}`,
    `function tick() {\nout.push("tick " + ++ticks);\nreturn ticks;\n}`,
    `function other(...all) {\nreturn "other " + all.length + " " + typeof all[0];\n}`,
    `function show(value) {\nif (typeof value === "function") value = value();\ntry {\nreturn typeof value + " " + (typeof value === "object" ? JSON.stringify(value) : String(value));\n} catch (error) {\nreturn error.name;\n}\n}`,
  ];
  const count = random.between(2, 6);
  const calls: string[] = [];
  for (let index = 0; index < count; index++) {
    const name = `f${index}`;
    const isRest = random.chance(0.5);
    const start = [...new Set([pick(random, starts), ...(random.chance(0.3) ? [pick(random, starts)] : [])])].join("\n");
    const use = (isRest ? pick(random, usesOfAList) : pick(random, usesOfAnObject)).replace(/\bP\b/g, isRest ? `rest` : `options`).replaceAll(`NAME`, name);
    const parameters = isRest
      ? `first, ...rest`
      : pick(random, [`first, options`, `first, options`, `first, options = {}`, `first, options, depth = 0`, `first, options = { a: say("the default") }`]);
    const usesDepth = /\bdepth\b/.test(start + use) && !parameters.includes(`depth`);
    const body = `${usesDepth ? `const depth = typeof first === "number" ? first : 0;\n` : ``}${start}\n${use}`;
    const kind = random.below(8);
    const usesArguments = /\barguments\b|\bnew\.target\b|\bthis\b/.test(body);
    lines.push(
      kind === 0 && !usesArguments
        ? `const ${name} = (${parameters}) => {\n${body}\n};`
        : kind === 1
          ? `async function ${name}(${parameters}) {\n${body}\n}`
          : kind === 2
            ? `const ${name} = {\n${name}(${parameters}) {\n${body}\n},\n}.${name};`
            : kind === 3
              ? `function* ${name}(${parameters}) {\n${body}\n}`
              : `function ${name}(${parameters}) {\n${body}\n}`,
    );
    const isPlainFunction = kind > 3 || (kind === 0 && usesArguments);
    for (let site = random.between(1, 3); site > 0; site--) {
      const given = isRest ? pick(random, lists) : pick(random, objects);
      const all = [pick(random, [`round`, `tick()`, `undefined`, `"first"`]), ...(given === `` ? [] : [given])].join(", ");
      const way = random.below(10);
      calls.push(
        way === 0
          ? `${name}.call(shared, ${all})`
          : way === 1
            ? `${name}.apply(undefined, [${all}])`
            : way === 2
              ? `${name}.bind(null)(${all})`
              : way === 3 && isPlainFunction
                ? `new ${name}(${all})`
                : way === 4
                  ? `[0].map(() => ${name}(${all}))[0]`
                  : way === 5
                    ? `Reflect.apply(${name}, shared, [${all}])`
                    : `${name}(${all})`,
      );
    }
  }
  const rounds = pick(random, [4, 4, 12, 400]);
  lines.push(
    `async function main() {`,
    `for (let round = 0; round < ${rounds}; round++) {`,
    `enabled = ${pick(random, [`round % 2 === 1`, `round > ${rounds >> 1}`, `round % 5 === 4`, `round === ${rounds - 1}`])};`,
    `level = round % 4;`,
    `const from = out.length;`,
    ...calls.map(
      (call, index) =>
        `try {\nlet result = ${call};\nif (result && typeof result.next === "function") result = result.next().value;\nsay("call ${index}: " + show(await result));\n} catch (error) {\nsay("call ${index} threw " + error.name);\n}`,
    ),
    `if (round >= 6 && round < ${rounds - 3}) out.length = from;`,
    `if (kept.length > 50) kept.length = 0;`,
    `}`,
    `console.log(out.join("\\n"));`,
    `console.log(ticks, calls, kept.length, show(kept[0]));`,
    `}`,
    `main();`,
  );
  return lines.join("\n") + "\n";
}

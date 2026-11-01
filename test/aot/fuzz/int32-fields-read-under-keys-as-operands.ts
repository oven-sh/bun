// Fields declared int32 are read with brackets, under a key that is one of a few names, a symbol, an enum member, an element of a list of names
// or a parameter, and the value is an operand of an operator or of a built-in function. The result goes where an int32 is declared or is printed.
// The objects come out of JSON.parse, so a field may hold a fraction, a string, null, an object or nothing at all.
import type { Random } from "./random";

const declarations = [
  `interface P {\n  x: int32;\n  y: int32;\n  [depth]: int32;\n}`,
  `type P = { x: int32; y: int32; [depth]: int32 };`,
  `class P {\n  x: int32 = 1;\n  y: int32 = 2;\n  [depth]: int32 = 3;\n}`,
  `type P = { readonly x: int32; readonly y: int32; readonly [depth]: int32 };`,
  `interface Base {\n  x: int32;\n  [depth]: int32;\n}\ninterface P extends Base {\n  y: int32;\n}`,
  `type P = { x: int32 } & { y: int32; [depth]: int32 };`,
  `type P = Record<"x" | "y" | typeof depth, int32>;`,
  `interface G<T> {\n  x: T;\n  y: T;\n  [depth]: T;\n}\ntype P = G<int32>;`,
  `interface A {\n  x: int32;\n  y: int32;\n  [depth]: int32;\n}\ninterface B {\n  x: int32;\n  y: int32;\n  [depth]: int32;\n  name: string;\n}\ntype P = A | B;`,
] as const;

const keys = [`k`, `k`, `key`, `name`, `Axis.X`, `Axis.Y`, `depth`, `names[at]`, `pickKey()`, `flag ? "x" : "y"`, `(k satisfies "x" | "y")`] as const;
const receivers = [`p`, `p`, `p`, `q`, `q`, `holder.p`, `list[at]`, `same(p)`, `(flag ? p : q)`] as const;

// What the documentation lists as proven to be an int32 when its operands are.
const proven = [
  (e: string, f: string) => `${e}`,
  (e: string, f: string) => `${e} && ${f}`,
  (e: string, f: string) => `${e} || 6`,
  (e: string, f: string) => `${e} ?? 6`,
  (e: string, f: string) => `flag ? ${e} : ${f}`,
  (e: string, f: string) => `(tick(), ${e})`,
  (e: string, f: string) => `${e}!`,
  (e: string, f: string) => `+${e}`,
  (e: string, f: string) => `Math.min(${e}, ${f})`,
  (e: string, f: string) => `Math.max(${e}, 40)`,
  (e: string, f: string) => `Math.min(${e} as number, 11)`,
  (e: string, f: string) => `Math.min(Math.max(${e}, 0), 10)`,
  (e: string, f: string) => `Math.max(${e} || 6, ${f} ?? 3)`,
  (e: string, f: string) => `Math.sign(${e})`,
  (e: string, f: string) => `Math.floor(${e} / 2)`,
  (e: string, f: string) => `Math.floor(${e} / 5)`,
  (e: string, f: string) => `Math.imul(${e}, ${f})`,
  (e: string, f: string) => `Math.clz32(${e})`,
  (e: string, f: string) => `${e} | 0`,
  (e: string, f: string) => `${e} & ${f}`,
  (e: string, f: string) => `${e} ^ 3`,
  (e: string, f: string) => `~${e}`,
  (e: string, f: string) => `${e} << 2`,
  (e: string, f: string) => `${e} >> 1`,
  (e: string, f: string) => `(${e} + ${f}) | 0`,
  (e: string, f: string) => `(${e} - ${f}) | 0`,
  (e: string, f: string) => `(${e} * ${f}) | 0`,
  (e: string, f: string) => `(${e} / ${f}) | 0`,
  (e: string, f: string) => `(${e} & 255) * 3 + 1`,
  (e: string, f: string) => `(${e} & 1023) % 7`,
  (e: string, f: string) => `Math.trunc((${e} & 1023) / 3)`,
] as const;

const printed = [
  (e: string, f: string) => `${e} + ${f}`,
  (e: string, f: string) => `${e} - 1`,
  (e: string, f: string) => `${e} * ${f}`,
  (e: string, f: string) => `${e} / 2`,
  (e: string, f: string) => `${e} / ${f}`,
  (e: string, f: string) => `${e} % 3`,
  (e: string, f: string) => `${e} % ${f}`,
  (e: string, f: string) => `${e} ** 2`,
  (e: string, f: string) => `2 ** ${e}`,
  (e: string, f: string) => `${e} < ${f}`,
  (e: string, f: string) => `${e} <= 5`,
  (e: string, f: string) => `${e} > ${f}`,
  (e: string, f: string) => `0 >= ${e}`,
  (e: string, f: string) => `-${e}`,
  (e: string, f: string) => `Object.is(-${e}, -0)`,
  (e: string, f: string) => `Object.is(${e} * -1, -0)`,
  (e: string, f: string) => `1 / ${e}`,
  (e: string, f: string) => `${e} + "s"`,
  (e: string, f: string) => `"s" + ${e} + ${f}`,
  (e: string, f: string) => `\`\${${e}}|\${${f}}\``,
  (e: string, f: string) => `${e} >>> 0`,
  (e: string, f: string) => `${e} === ${f}`,
  (e: string, f: string) => `${e} == 5`,
  (e: string, f: string) => `${e} !== 0`,
  (e: string, f: string) => `!${e}`,
  (e: string, f: string) => `typeof ${e}`,
  (e: string, f: string) => `Math.abs(${e})`,
  (e: string, f: string) => `Math.round(${e} * 0.5)`,
  (e: string, f: string) => `Math.ceil(${e} / 3)`,
  (e: string, f: string) => `Math.trunc(${e} / ${f})`,
  (e: string, f: string) => `Math.sqrt(${e})`,
  (e: string, f: string) => `Math.pow(${e}, 2)`,
  (e: string, f: string) => `Math.hypot(${e}, ${f})`,
  (e: string, f: string) => `Math.fround(${e})`,
  (e: string, f: string) => `Math.min(${e})`,
  (e: string, f: string) => `Math.max(${e}, ${f}, 0.5)`,
  (e: string, f: string) => `Math.atan2(${e}, ${f})`,
  (e: string, f: string) => `Number(${e})`,
  (e: string, f: string) => `String(${e})`,
  (e: string, f: string) => `isNaN(${e})`,
  (e: string, f: string) => `Number.isInteger(${e})`,
  (e: string, f: string) => `Number.isSafeInteger(${e} + ${f})`,
  (e: string, f: string) => `[${e}, ${f}].join()`,
  (e: string, f: string) => `"abcdefgh".charAt(${e})`,
  (e: string, f: string) => `"abcdefgh".slice(${e}, ${f})`,
  (e: string, f: string) => `[10, 20, 30, 40, 50, 60][${e}]`,
  (e: string, f: string) => `(${e} + ${f}) / 2 + (${e} - ${f}) * 3`,
  (e: string, f: string) => `${e} + ${e} + ${f} + ${f} + ${e}`,
  (e: string, f: string) => `(${e} < ${f} ? ${e} : ${f}) + 1`,
  (e: string, f: string) => `(${e} && ${f}) + (${e} || ${f}) + (${e} ?? ${f})`,
] as const;

const bodies = [
  (e: string, f: string) => `let sum: int32 = 0;\nfor (let i: int32 = 0; i < ${e} && i < 40; i++) sum = (sum + i) | 0;\nreturn sum;`,
  (e: string, f: string) => `let i: int32 = 0;\nwhile (${e} > i && i < 40) i++;\nreturn i;`,
  (e: string, f: string) => `let text = "";\nfor (let i = ${e}; i < ${f} && text.length < 40; i++) text += i;\nreturn text;`,
  (e: string, f: string) => `const half = Math.floor(${e} / 2);\nconst least = Math.min(${e}, ${f});\nreturn take(half) + take(least);`,
  (e: string, f: string) => `let held: int32 = ${e};\nheld = Math.max(held, ${f});\nreturn held;`,
  (e: string, f: string) => `switch (${e} + 1) {\ncase 6:\nreturn "six";\ncase 0:\nreturn "zero";\ndefault:\nreturn "other";\n}`,
  (e: string, f: string) => `if (${e} > 0 && ${f} > 0) return ${e} % ${f};\nreturn -1;`,
] as const;

const held = [
  `5`,
  `5`,
  `7`,
  `12`,
  `0`,
  `-1`,
  `2147483647`,
  `-2147483648`,
  `0.5`,
  `-0`,
  `2147483648`,
  `1e300`,
  `"7"`,
  `""`,
  `null`,
  `true`,
  `{}`,
  `[3]`,
  undefined,
] as const;

function pick<T>(random: Random, list: readonly T[]): T {
  return list[random.below(list.length)];
}

export function generate(random: Random): string {
  const declaration = pick(random, declarations);
  const isClass = declaration.startsWith("class");
  const isOrdinary = random.chance(0.4);
  const read = () => `${pick(random, receivers)}[${pick(random, keys)}]`;
  const object = () => {
    const values = isOrdinary ? held.slice(0, 8) : held;
    const fields = [`x`, `y`, `depth`].map(name => [name, pick(random, values)] as const).filter(([, value]) => value !== undefined);
    return `made(${JSON.stringify(`{${fields.map(([name, value]) => `"${name}":${value}`).join(",")}}`)})`;
  };
  const lines = [
    `import type { int32 } from "bun";`,
    `const depth: unique symbol = Symbol("depth");`,
    `enum Axis {\n  X = "x",\n  Y = "y",\n}`,
    declaration,
    `let ticks = 0;`,
    `function tick(): void {\n  ticks++;\n}`,
    `function take(n: int32): int32 {\n  return n;\n}`,
    `function same<T>(value: T): T {\n  return value;\n}`,
    `function made(text: string): P {\n  const { depth: deep, ...rest } = JSON.parse(text.slice(ticks));\n  const target = ${isClass ? `new P()` : `{}`};\n  Object.assign(target, rest);\n  if (deep !== undefined) (target as any)[depth] = deep;\n  return target as P;\n}`,
    `const names = ["x", "y"] as const;`,
    `let at = Date.now() > 0 ? ${random.below(2)} : 0;`,
    `let key: "x" | "y" = Date.now() > 0 ? "${pick(random, [`x`, `y`])}" : "x";`,
    `const name = (Date.now() > 0 ? "${pick(random, [`x`, `y`])}" : "y") as keyof P;`,
    `function pickKey(): "x" | "y" {\n  tick();\n  return key;\n}`,
    `const objects = [${Array.from({ length: random.between(2, 4) }, object).join(", ")}];`,
    `const holder = { p: objects[0] };`,
    `const list = [objects[1], objects[0]];`,
  ];
  const count = random.between(4, 14);
  for (let index = 0; index < count; index++) {
    const way = random.below(10);
    const body =
      way < 4
        ? `return take(${pick(random, proven)(read(), read())});`
        : way < 8
          ? `return ${pick(random, printed)(read(), read())};`
          : pick(random, bodies)(read(), read());
    lines.push(`function f${index}(p: P, q: P, k: "x" | "y", flag: boolean) {\n${body}\n}`);
  }
  const rounds = pick(random, [1, 1, 3, 300]);
  lines.push(
    `const out: string[] = [];`,
    `const functions = [${Array.from({ length: count }, (_, index) => `f${index}`).join(", ")}];`,
    `function run(name: string, call: (p: P, q: P, k: "x" | "y", flag: boolean) => unknown): void {`,
    `  for (let round = 0; round < ${rounds}; round++)`,
    `    for (const p of objects)`,
    `      for (const q of objects) {`,
    `        let line: string;`,
    `        try {`,
    `          const result = call(p, q, round & 1 ? "x" : "y", (round & 2) === 0);`,
    `          line = typeof result + " " + (Object.is(result, -0) ? "-0" : String(result));`,
    `        } catch (error) {`,
    `          line = "threw " + (error as Error).name;`,
    `        }`,
    `        if (round < 4 || round === ${rounds - 1}) out.push(name + " " + line);`,
    `      }`,
    `}`,
  );
  for (let index = 0; index < count; index++)
    lines.push(
      random.chance(0.7)
        ? `run("f${index}", (p, q, k, flag) => f${index}(p, q, k, flag));`
        : `run("f${index}", functions[${index}]);`,
    );
  lines.push(`console.log(out.join("\\n"));`, `console.log(ticks);`);
  return lines.join("\n") + "\n";
}

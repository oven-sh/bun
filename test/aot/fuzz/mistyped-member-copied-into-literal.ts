// About ten lines of TypeScript: two interfaces, one typed function that copies a member of its parameter, without
// inspecting it, into a new literal beside a number, one call with a conforming object, and one call with an object
// whose member has another type.
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const [type, sound] = random.pick([
    ["number[]", "[1, 2]"],
    ["number[]", "[1.5]"],
    ["string[]", `["a"]`],
    ["number[][]", "[[1]]"],
    ["{ x: number }", "{ x: 1 }"],
    ["{ x: number; y: string }", `{ x: 1, y: "y" }`],
    ["[number, string]", `[1, "p"]`],
    ["() => number", "() => 1"],
    ["Made", "new Made()"],
    ["Map<string, number>", "new Map()"],
  ] as const);
  const odd = random.pick([
    "-1.5",
    "0.25",
    "7",
    "-3",
    "2147483648",
    "-0",
    "NaN",
    `"w"`,
    `""`,
    "true",
    "null",
    "undefined",
    "",
    `["t"]`,
    "[]",
    "{ z: 2.5 }",
    "1e300",
  ]);
  const neighbor = () => random.pick(["0.125", "2.5", "1", "-7", `"n"`, "4294967296", "true"]);
  const typeOf = (value: string) => (/^"/.test(value) ? "string" : value === "true" ? "boolean" : "number");
  const [first, second] = [neighbor(), neighbor()];
  const hasTwo = random.chance(0.3);
  const isAhead = random.chance(0.6);
  const fields = isAhead ? [`e: ${type}`, `c: ${typeOf(first)}`] : [`c: ${typeOf(first)}`, `e: ${type}`];
  const laid = isAhead ? ["e: p.b", `c: ${first}`] : [`c: ${first}`, "e: p.b"];
  if (hasTwo) {
    fields.push(`g: ${typeOf(second)}`);
    laid.push(`g: ${second}`);
  }
  const other = random.pick([`d: string; `, "", `d: number; `]);
  const otherSound = other.startsWith("d: string") ? `d: "s", ` : other ? "d: 1, " : "";
  const keepsOther = random.chance(0.3);
  const lines = [
    ...(type === "Made" ? ["class Made {\n  m = 1;\n}"] : []),
    `interface I1 { ${fields.join("; ")} }`,
    `interface I2 { ${other}b: ${type} }`,
    `function f(p: I2): I1 {\n  return { ${laid.join(", ")} };\n}`,
  ];
  const soundCall = `f({ ${otherSound}b: ${sound} });`;
  const place = random.weighted([
    [6, "ahead"],
    [1, "behind"],
    [1, "none"],
    [1, "often"],
  ]);
  if (place === "ahead") lines.push(soundCall);
  if (place === "often") lines.push(`for (let i = 0; i < 50; i++) ${soundCall}`);
  lines.push(
    random.weighted([
      [5, "const launder = (v: any): I2 => v;"],
      [
        1,
        'const launder = (v: any): I2 => JSON.parse(JSON.stringify(v, (_, each) => (typeof each === "number" && !Number.isFinite(each) ? null : each)));',
      ],
      [1, "function launder<T>(v: T): I2 {\n  return v as any;\n}"],
      [1, "const launder = (v: unknown) => v as I2;"],
    ]),
  );
  lines.push(`const odd = launder({ ${keepsOther ? otherSound : ""}${odd ? `b: ${odd}` : ""} });`);
  const show = random.weighted([
    [6, "f(odd).c"],
    [2, "typeof f(odd).e"],
    [2, "String(f(odd).e)"],
    [1, "JSON.stringify(f(odd))"],
    [1, "Object.keys({ ...f(odd) }).join()"],
    [1, "[f(odd), f(odd)].length"],
    [1, "again(f(odd)).c"],
    [1, "(r => [r.c, typeof r.e].join())(f(odd))"],
  ]);
  if (show.startsWith("again")) lines.push(`function again(r: I1): I1 {\n  return { ...r, e: r.e };\n}`);
  lines.push(
    random.weighted([
      [5, `for (let i = 0; i < 1; i++) console.log(${show});`],
      [2, `console.log(${show});`],
      [2, `for (let i = 0; i < 3; i++) console.log(${show});`],
      [
        1,
        `const kept: unknown[] = [];\nfor (let i = 0; i < 2000; i++) kept.push(f(odd));\nconsole.log(kept.length, ${show});`,
      ],
    ]),
  );
  if (place === "behind") lines.push(soundCall);
  return { file: "main.ts", text: lines.join("\n") + "\n" };
}

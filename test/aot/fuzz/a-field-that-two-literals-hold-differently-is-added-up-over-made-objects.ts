// A function makes objects, a loop fills lists with them, and loops add one of their fields up. Another literal holds something else than a number under the same name. Built with the types erased.
//
//   the other literal   a text, a fraction, null, a list, an object, a boolean, or none
//   the lists           none to a thousand objects; the field counts up, jumps, comes near the ends of 32 bits, or is a fraction once or always
//   the sum             starts at nothing, at an end of 32 bits, past it, or at a fraction, and is added to or taken from
//   the loops           one to three: for-of, by index, one inside another, left early, with turns passed over; beside the sum a counter or the last value
//   where               at the top level, in a function called once or twice, in a try block, in an arrow
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const lines: string[] = [];
  const field = random.pick(["kept", "size", "mass"]);
  const others = random.sample(["label", "name", "at", "next"], random.between(1, 3));
  if (random.chance(0.9))
    lines.push(
      `const holder = { ${field}: ${random.pick(['"a"', '"a"', "1.5", "null", "[1]", "{ x: 1 }", "true"])} };`,
      `console.log(typeof holder.${field});`,
    );
  const beside = others.map(name => `${name}: 1`);
  lines.push(
    `function create(${field}: number) {`,
    `  return { ${(random.chance(0.7) ? [...beside, field] : [field, ...beside]).join(", ")} };`,
    "}",
  );
  const body: string[] = [];
  const lists = random.between(1, 2);
  for (let list = 0; list < lists; list++) {
    const length = random.pick([0, 1, 2, 3, 3, 3, 4, 7, 8, 9, 10, 10, 16, 17, 31, 32, 33, 64, 100, 1000]);
    const value = random.pick([
      "i",
      "i",
      "i",
      "i * 3",
      "2147483647 - i",
      "-i",
      "i % 2 ? i : -i",
      "i << 28",
      "i * 1000000",
      "i * 100000000",
      `i === ${Math.max(length - 1, 0)} ? 0.5 : i`,
      "i + 0.5",
      `i === ${length >> 1} ? 2147483647 : i`,
    ]);
    body.push(
      `const list${list}: any[] = [];`,
      `for (let i = 0; i < ${length}; i++) list${list}.push(create(${value}));`,
    );
  }
  body.push(
    `let sum = ${random.pick(["0", "0", "0", "1", "2147483647", "-2147483648", "0.5", "2147483640", "4294967296"])};`,
    "let count = 0;",
    "let last = -1;",
  );
  for (let loop = 0, loops = random.between(1, 3); loop < loops; loop++) {
    const list = `list${random.below(lists)}`;
    const turn = `sum ${random.pick(["+=", "+=", "+=", "-="])} each.${field};${random.pick(["", "", "", " count++;", ` if (each.${field} > 2) count++;`, ` last = each.${field};`, " count += 2; last = count;"])}`;
    body.push(
      random.pick([
        `for (const each of ${list}) { ${turn} }`,
        `for (const each of ${list}) { ${turn} }`,
        `for (const each of ${list}) { ${turn} }`,
        `for (const each of ${list}) { ${turn} }`,
        `for (let i = 0; i < ${list}.length; i++) { const each = ${list}[i]; ${turn} }`,
        `for (let round = 0; round < ${random.pick([1, 2, 3, 5])}; round++) for (const each of ${list}) { ${turn} }`,
        `for (const each of ${list}) { if (each.${field} === ${random.pick([2, 5, 9, -1])}) break; ${turn} }`,
        `for (const each of ${list}) { if (each.${field} === ${random.pick([0, 1, 2, 5])}) continue; ${turn} }`,
      ]),
    );
    if (random.chance(0.5)) body.push("console.log(sum, count, last);");
  }
  body.push("console.log(sum, count, last);");
  const indented = body.map(line => "  " + line);
  lines.push(
    ...random.pick([
      body,
      body,
      body,
      ["function main() {", ...indented, "}", "main();"],
      ["function main() {", ...indented, "}", "main();", "main();"],
      ["try {", ...indented, "} catch (error) {", "  console.log((error as Error).name);", "}"],
      ["const main = () => {", ...indented, "};", "main();"],
    ]),
  );
  return { file: "main.ts", text: lines.join("\n") + "\n" };
}

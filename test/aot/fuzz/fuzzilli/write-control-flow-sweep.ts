// Random flow of control: chains of comparisons and switches over texts and numbers, loops of few and of many turns, labels, handlers, small functions, in each other and behind each other. Every function is called with many arguments.
//
//   bun write-control-flow-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<statements>.mjs
import { mkdirSync, writeFileSync } from "node:fs";

function write(cell: number): { name: string; text: string } {
  let state = (cell * 2654435761 + 97531) >>> 0;
  const random = (below: number) => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % below;
  };
  for (let warm = 0; warm < 6; warm++) random(2);
  const from = <T>(list: readonly T[]): T => list[random(list.length)]!;
  const isTyped = random(3) === 0;
  const words = ["red", "green", "blue", "x1", "a", "", "redder", "1", "ab"];
  let names = 0;
  let statements = 0;
  // The labels of the loops and of the blocks around, the innermost last.
  type Around = { label: string; isLoop: boolean }[];

  const word = () => JSON.stringify(from(words));
  const text = () => from(["s", "u", "words[a % words.length]", "words[0]", 's + "x"', "s.slice(1)", "u.slice(0, 2)", "wordOf(a)", "String(a % 4)", "row.kind", word()]); // prettier-ignore
  const number = () => from(["a", "b", "n", "a + 1", "b * 2", "(a + b) % 7", "s.length", "a & 3", "kindOf(s)", "u.length + 1", "words.length", "row.count", String(random(6)), "-a", "a >> 1", "b | 0", "c0", "c1", "c0 + c1", "c2"]); // prettier-ignore
  const condition = (): string => {
    switch (random(16)) {
      case 0:
      case 1:
      case 2:
        return `${text()} === ${word()}`;
      case 3:
        return `${text()} !== ${word()}`;
      case 4:
        return `${number()} < ${number()}`;
      case 5:
        return `${number()} === ${number()}`;
      case 6:
        return `(${number()}) & 1`;
      case 7:
        return `words.includes(${text()})`;
      case 8:
        return `${text()}.length > ${random(4)}`;
      case 9:
        return `${text()}[0] === "r"`;
      case 10:
        return `${text()}.startsWith("re")`;
      case 11:
        return `${text()} in table`;
      case 12:
        return `(${condition()}) && (${condition()})`;
      case 13:
        return `(${condition()}) || (${condition()})`;
      case 14:
        return `!(${condition()})`;
      default:
        return from(["a > b", "s", "row.kind === u", "a === n", "s < u", "flag"]);
    }
  };
  const assign = () =>
    from([
      () => `a = ${number()};`,
      () => `b = ${number()};`,
      () => `a += ${number()};`,
      () => `b -= ${random(4)};`,
      () => `s = ${text()};`,
      () => `u = ${text()};`,
      () => `flag = ${condition()} ? true : false;`,
      () => `row.count += ${random(3)};`,
      () => `row.kind = ${text()};`,
      () => `notes.push(${random(2) ? text() : number()});`,
      () => `a = ${text()} === ${word()} ? ${number()} : ${text()} === ${word()} ? ${number()} : b;`,
      () => `s = ${condition()} ? ${text()} : ${text()};`,
      () => `a ||= ${number()};`,
      () => `s += ${word()};`,
    ])();
  const leave = (around: Around): string => {
    const loops = around.filter(one => one.isLoop);
    const choices = [`return s + a;`];
    if (loops.length) choices.push("break;", "continue;", "break;", "continue;", `break ${from(loops).label};`, `continue ${from(loops).label};`); // prettier-ignore
    if (around.length) choices.push(`break ${from(around).label};`);
    return `if (${condition()}) ${from(choices)}`;
  };
  const indent = (code: string) => code.split("\n").map(line => "  " + line).join("\n"); // prettier-ignore
  function block(depth: number, around: Around): string {
    const lines: string[] = [];
    for (let at = 1 + random(3); at > 0; at--) lines.push(statement(depth, around));
    return indent(lines.join("\n"));
  }
  function arms(depth: number, around: Around, cases: string[], isTextual: boolean): string {
    const lines: string[] = [];
    const defaultAt = random(cases.length + 2);
    const inSwitch: Around = around.map(one => one);
    cases.forEach((value, at) => {
      if (at === defaultAt)
        lines.push(`  default:\n${indent(block(depth - 1, inSwitch))}${random(3) ? "\n    break;" : ""}`);
      lines.push(`  case ${value}:`);
      if (random(5)) lines.push(`${indent(block(depth - 1, inSwitch))}${random(4) ? "\n    break;" : ""}`);
    });
    if (defaultAt === cases.length) lines.push(`  default:\n${indent(block(depth - 1, inSwitch))}`);
    return lines.join("\n") + (isTextual ? "" : "");
  }
  function statement(depth: number, around: Around): string {
    statements++;
    if (depth <= 0 || statements > 60) return random(4) ? assign() : leave(around);
    switch (random(18)) {
      case 15: {
        // A loop whose counter is read behind it.
        const counter = from(["c0", "c1", "c2"]);
        if (random(2)) return `while (${counter} < s.length && s[${counter}] !== ${JSON.stringify(from(["e", "x", "d"]))}) ${counter}++;`; // prettier-ignore
        const label = "l" + ++names;
        return `${label}: for (; ${counter} < ${from(["words.length", "n", "4", "9"])}; ${counter}++) {\n  if (--fuel < 0) return "fuel";\n  if (${condition()}) break;\n${block(depth - 1, [...around, { label, isLoop: true }])}\n}`; // prettier-ignore
      }
      case 16: {
        // A chain of written texts alone: with assignments, as an expression, with returns.
        const asked = from(["s", "u", "words[a % words.length]", "row.kind"]);
        const chain = [...new Set(Array.from({ length: 6 }, word))];
        if (random(3) === 0)
          return `a = ${chain.map(one => `${asked} === ${one} ? ${number()} : `).join("")}${number()};`;
        const doing = random(3) === 0 ? () => `return "r" + (${number()});` : () => `b = ${number()};`;
        return chain.map(one => `if (${asked} === ${one}) ${doing()}`).join("\n" + (random(2) ? "else " : ""));
      }
      case 17: {
        // The same in a loop over texts.
        const chain = [...new Set(Array.from({ length: 6 }, word))];
        return `for (const w of words) {\n  if (--fuel < 0) return "fuel";\n  ${chain.map(one => `if (w === ${one}) a += ${number()};`).join("\n  else ")}\n  else a--;\n}`; // prettier-ignore
      }
      case 0:
      case 1:
        return assign();
      case 2:
        return leave(around);
      case 3:
        return `if (${condition()}) {\n${block(depth - 1, around)}\n} else {\n${block(depth - 1, around)}\n}`;
      case 4:
      case 5: {
        // A chain of comparisons of one text, of which an arm may ask something else.
        const asked = from(["s", "u", "row.kind"]);
        const chain = Array.from({ length: 2 + random(4) }, () => (random(6) ? `${asked} === ${word()}` : condition()));
        return chain.map(one => `if (${one}) {\n${block(depth - 1, around)}\n}`).join(" else ") + (random(3) ? ` else {\n${block(depth - 1, around)}\n}` : ""); // prettier-ignore
      }
      case 6:
        return `switch (${text()}) {\n${arms(depth, around.filter(one => !one.isLoop || true), [...new Set(Array.from({ length: 2 + random(4) }, word))], true)}\n}`; // prettier-ignore
      case 7:
        return `switch (${from(["a % 5", "(a + b) & 7", "kindOf(s)", "s.length"])}) {\n${arms(depth, around, [...new Set(Array.from({ length: 2 + random(5) }, () => String(random(7))))], false)}\n}`; // prettier-ignore
      case 8:
        return `switch (true) {\n${arms(depth, around, Array.from({ length: 2 + random(2) }, condition), false)}\n}`;
      case 9:
      case 10: {
        const label = "l" + ++names;
        const counter = "i" + names;
        const inside = [...around, { label, isLoop: true }];
        const bound = from(["1", "2", "3", "4", "n", "words.length", "n + 2"]);
        return `${label}: for (let ${counter} = 0; ${counter} < ${bound}; ${counter}++) {\n  if (--fuel < 0) return "fuel";\n  ${random(2) ? `a += ${counter};` : `u = words[${counter} % words.length];`}\n${block(depth - 1, inside)}\n}`; // prettier-ignore
      }
      case 11: {
        const label = "l" + ++names;
        const inside = [...around, { label, isLoop: true }];
        if (random(2)) return `${label}: for (const item${names} of ${from(["words", '["red", s, "b"]', "[1, 2]"])}) {\n  if (--fuel < 0) return "fuel";\n  u = String(item${names});\n${block(depth - 1, inside)}\n}`; // prettier-ignore
        return random(2)
          ? `${label}: while (--fuel > 0 && (${condition()})) {\n${block(depth - 1, inside)}\n}`
          : `${label}: do {\n  if (--fuel < 0) return "fuel";\n${block(depth - 1, inside)}\n} while (${condition()});`;
      }
      case 12: {
        const label = "k" + ++names;
        return `${label}: {\n${block(depth - 1, [...around, { label, isLoop: false }])}\n}`;
      }
      case 13:
        return `try {\n${block(depth - 1, around)}\n  if (${condition()}) throw new RangeError(s);\n} catch (error) {\n  u = error.message;\n${block(depth - 1, around)}\n}${random(3) ? "" : ` finally {\n  ${assign()}\n}`}`; // prettier-ignore
      default:
        return `for (const name in table) {\n  if (--fuel < 0) return "fuel";\n  if (name === s) {\n${indent(block(depth - 1, around.map(one => ({ ...one, isLoop: false }))))}\n  }\n}`; // prettier-ignore
    }
  }
  const body = Array.from({ length: 3 + random(3) }, () => statement(3, [])).join("\n");
  const lines = [
    "let fuel = 0;",
    `const notes = [];`,
    `const table = { red: 1, ab: 2, "1": 3 };`,
    `function kindOf(text) {`,
    '  if (text === "red") return 1;',
    '  if (text === "green" || text === "blue") return 2;',
    '  if (text === "") return 0;',
    "  return text.length > 3 ? 5 : 3;",
    "}",
    `function wordOf(at) {`,
    "  switch (at % 4) {",
    "    case 0:",
    '      return "red";',
    "    case 1:",
    '      return "ab";',
    "    case 2:",
    '      return "x" + at;',
    "  }",
    '  return "";',
    "}",
    ...(isTyped ? ["/** @param {number} n @param {string} s @param {string[]} words @returns {string} */"] : []),
    `function run(n, s, words) {`,
    "  let a = n;",
    "  let b = 2;",
    "  let c0 = 0;",
    "  let c1 = 0;",
    "  let c2 = 0;",
    '  let u = "";',
    "  let flag = false;",
    "  const row = { kind: s, count: n };",
    indent(body),
    '  return [a, b, s, u, flag, row.kind, row.count, c0, c1, c2].join("|");',
    "}",
    `const lists = JSON.parse('[["red","green","blue"],["a"],["","x1","redder","ab","1"]]');`,
    "for (let n = 0; n < 5; n++) {",
    "  for (const words of lists) {",
    '    for (const s of ["red", "blue", "x", "", words[n % words.length]]) {',
    "      fuel = 60;",
    "      try {",
    "        const said = run(n, s, words);",
    '        notes.push(said.length > 60 ? said.length + said.slice(0, 40) : said);',
    "      } catch (error) {",
    `        notes.push("!" + error.name);`,
    "      }",
    "    }",
    "  }",
    "}",
    'const all = notes.join(" ");',
    "let hash = 0;",
    "for (let i = 0; i < all.length; i++) hash = (Math.imul(hash, 31) + all.charCodeAt(i)) | 0;",
    "console.log(notes.length, hash, all.slice(0, 300));",
  ]; // prettier-ignore
  return { name: `${statements}.mjs`, text: lines.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(9, "0");
const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? 100), Number(process.argv[5] ?? 1)]; // prettier-ignore
mkdirSync(folder, { recursive: true });
for (let step = 0; step < count; step++) {
  const index = from + step * stride;
  const program = write(index);
  writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
}
console.log(count);

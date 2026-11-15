// Variables that a direct eval() sees: what the variable holds, times what the text of the eval does with it, times where the eval stands, times what the function does with the variable, times how often it is called.
//
//   bun write-eval-variable-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<value>--<text>--<place>--<use>--<call>.cjs or .mjs
//   bun write-eval-variable-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is the parameter.
const values: [name: string, text: string][] = [
  ["integer", "n"],
  ["double", "n * 0.5"],
  ["text", '"t" + n'],
  ["list", "[n, 2]"],
  ["object", "{ v: n }"],
  ["typed", "new Float64Array([n, 2])"],
  ["function", "() => n"],
  ["nothing", "undefined"],
  ["truth", "n > 1"],
  ["big", "BigInt(n)"],
  ["instance", "new Row(n)"],
  ["negative-zero", "-0 * n"],
];
// The text of the eval; `x` is the variable.
const texts: [name: string, text: string][] = [
  ["reads", "x"],
  ["writes", "x = 7"],
  ["writes-double", "x = 0.25"],
  ["writes-text", "x = 'w'"],
  ["adds", "x += 1"],
  ["steps", "x++"],
  ["reads-field", "x.v"],
  ["writes-field", "x.v = 5; x.v"],
  ["closure", "() => x"],
  ["writing-closure", "() => (x = 9)"],
  ["declares", "var y = 3; y"],
  ["declares-same", "var x2 = x; x2"],
  ["let", "let x = 4; x"],
  ["function", "function inner() { return x; } inner()"],
  ["other", "n + 1"],
  ["arguments", "arguments.length"],
  ["this", "typeof this"],
  ["throws", "throw new RangeError('e')"],
  ["syntax", "x +"],
  ["nothing", ""],
  ["loop", "let s = 0; for (let i = 0; i < 3; i++) s += i; s"],
  ["nested", "eval('x')"],
  ["parameter", "n = 20"],
  ["typeof", "typeof x"],
  ["delete", "typeof z"],
];
// `E` is the eval, `USE` what the function does.
const places: [name: string, text: string][] = [
  ["front", "let x = VALUE;\nconst got = E;\nUSE\nreturn show([got, x, n]);"],
  ["behind", "let x = VALUE;\nUSE\nconst got = E;\nreturn show([got, x, n]);"],
  ["between", "let x = VALUE;\nUSE\nconst got = E;\nUSE\nreturn show([got, x, n]);"],
  [
    "in-a-loop",
    "let x = VALUE;\nlet got;\nfor (let k = 0; k < 3; k++) {\n  got = E;\n  USE\n}\nreturn show([got, x, n]);",
  ],
  ["in-a-branch", "let x = VALUE;\nlet got;\nif (n > 1) got = E;\nUSE\nreturn show([got, x, n]);"],
  [
    "in-a-try",
    "let x = VALUE;\nlet got;\ntry {\n  got = E;\n} catch (error) {\n  got = error.name;\n}\nUSE\nreturn show([got, x, n]);",
  ],
  ["in-an-arrow", "let x = VALUE;\nconst ask = () => E;\nUSE\nconst got = ask();\nreturn show([got, x, n]);"],
  [
    "in-a-block",
    "let x = VALUE;\nlet got;\n{\n  let x = 30;\n  got = E;\n  got = [got, x];\n}\nUSE\nreturn show([got, x, n]);",
  ],
  [
    "constant",
    "const x = VALUE;\nlet got;\ntry {\n  got = E;\n} catch (error) {\n  got = error.name;\n}\nUSE\nreturn show([got, x, n]);",
  ],
  ["variable", "var x = VALUE;\nconst got = E;\nUSE\nreturn show([got, x, n]);"],
  [
    "indirect",
    "let x = VALUE;\nlet got;\ntry {\n  got = (0, eval)(TEXT);\n} catch (error) {\n  got = error.name;\n}\nUSE\nreturn show([got, x, n]);",
  ],
  [
    "beside",
    "let x = VALUE;\nlet count = 0;\nfor (let k = 0; k < 20; k++) count += k;\nconst got = E;\nUSE\nreturn show([got, x, count]);",
  ],
];
const uses: [name: string, text: string][] = [
  ["nothing", ""],
  ["adds", 'if (typeof x === "number") notes.push(x + 1);'],
  ["shows", "notes.push(show(x));"],
  ["loop", "let sum = 0;\nfor (let i = 0; i < 4; i++) sum += Number(x) || i;\nnotes.push(sum);"],
  ["field", "notes.push(show(x?.v));"],
  ["element", "notes.push(show(x?.[0]));"],
  ["called", 'notes.push(typeof x === "function" ? x() : 0);'],
  ["captured", "const keep = () => x;\nnotes.push(show(keep()));"],
  ["parameter", "notes.push(n * 2);"],
  ["passed", "notes.push(take(x));"],
];
const calls: [name: string, text: string][] = [
  ["loop", "for (const n of [1, 2, 3]) attempt(() => work(n));"],
  ["once", "attempt(() => work(2));"],
  ["kinds", 'for (const n of [1, 0.5, 2]) attempt(() => work(n));\nattempt(() => work("7"));'],
  ["method", "const holder = { work };\nfor (const n of [2, 3]) attempt(() => holder.work(n));"],
];
const total = values.length * texts.length * places.length * uses.length * calls.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const value = pick(values);
  const text = pick(texts);
  const place = pick(places);
  const use = pick(uses);
  const call = pick(calls);
  // Sloppy evals declare variables in the function, strict ones in themselves; every fifth text is put together at run time.
  const isSloppy = cell % 2 === 0;
  const isMade = cell % 5 === 0;
  const indent = (code: string, by: string) => code.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const given = isMade
    ? `[${JSON.stringify(text[1].slice(0, 3))}, ${JSON.stringify(text[1].slice(3))}].join("")`
    : JSON.stringify(text[1]);
  const body = place[1]
    .replaceAll("TEXT", () => given)
    .replaceAll(/\bE\b/g, () => `eval(${given})`)
    .replaceAll("USE", () =>
      use[1].includes("let ") || use[1].includes("const ") ? `{\n${indent(use[1], "  ")}\n}` : use[1],
    )
    .replaceAll("VALUE", () => value[1]);
  const lines = [
    "const notes = [];",
    'const show = value => (typeof value === "function" ? "function" : typeof value === "bigint" ? value + "n" : ArrayBuffer.isView(value) || Array.isArray(value) ? "[" + Array.from(value, show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));',
    "const attempt = ask => {\n  try {\n    notes.push(ask());\n  } catch (error) {\n    notes.push(error.name);\n  }\n};",
    "class Row {\n  constructor(v) {\n    this.v = v;\n  }\n}",
    "const take = value => typeof value;",
    "function work(n) {",
    indent(body, "  ").split("\n").filter(line => line.trim()).join("\n"),
    "}",
    call[1],
    'console.log(notes.join(" "));',
  ]; // prettier-ignore
  return {
    name: `${value[0]}--${text[0]}--${place[0]}--${use[0]}--${call[0]}.${isSloppy ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}

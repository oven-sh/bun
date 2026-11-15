// Statics in loops: how the static is written, times what it holds, times how the loop uses it, times who else touches it, times the loop.
//
//   bun write-static-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<static>--<value>--<use>--<other>--<loop>.ts or .mjs
//   bun write-static-loop-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `S` is how the static is reached, `VALUE` what it starts with.
const statics: [name: string, reach: string, before: string][] = [
  [
    "field",
    "S.v",
    "class S {\n  static v = VALUE;\n  static w = 1;\n  static bump() {\n    BUMP\n    return S.v;\n  }\n  static idle() {\n    return 1;\n  }\n  ask() {\n    return S.v;\n  }\n}",
  ],
  ["private", "S.#v", "PRIVATE"],
  ["late", "S.v", "class S {\n  static bump() {\n    BUMP\n  }\n}\nS.v = VALUE;"],
  ["inherited", "T.v", "class S {\n  static v = VALUE;\n  static bump() {\n    BUMP\n  }\n}\nclass T extends S {}"],
  ["of-a-function", "S.v", "function S() {}\nS.v = VALUE;"],
  ["of-an-object", "S.v", "const S = { v: VALUE, w: 1, bump() {\n  BUMP\n  return S.v;\n} };"],
  ["of-a-frozen-holder", "S.inner.v", "const S = Object.freeze({ inner: { v: VALUE } });"],
  [
    "accessor",
    "S.v",
    "class S {\n  static kept = VALUE;\n  static get v() {\n    return S.kept;\n  }\n  static set v(value) {\n    S.kept = value;\n  }\n}",
  ],
  ["by-key", 'S["v"]', "class S {\n  static v = VALUE;\n}"],
  ["variable", "v", "let v = VALUE;\nconst S = { bump() {\n  v++;\n  return v;\n} };"],
  ["element", "S[0]", "const S = [VALUE, 1];"],
  ["of-this", "S.v", "class S {\n  static v = VALUE;\n  static {\n    this.v = VALUE;\n  }\n}"],
  ["getter-alone", "S.v", "class S {\n  static kept = VALUE;\n  static get v() {\n    return S.kept;\n  }\n}"],
];
const values: [name: string, text: string][] = [
  ["integer", "0"],
  ["double", "0.5"],
  ["largest", "2 ** 31 - 2"],
  ["text", '"t"'],
  ["list", "[1]"],
  ["nothing", "undefined"],
  ["null", "null"],
  ["big", "1n"],
  ["negative-zero", "-0"],
  ["truth", "true"],
  ["object", "{ x: 1 }"],
];
// What the method of the class does, where it has one.
const bumps: [name: string, text: string][] = [
  ["steps", "S.v++;"],
  ["stores-object", "this.v = {};"],
  ["stores-text", 'S.v = "b";'],
  ["stores-double", "this.v = 0.25;"],
  ["stores-nothing", "this.v = undefined;"],
  ["adds", "this.v = this.v + 1;"],
];
// `i` is the counter.
const uses: [name: string, text: string][] = [
  ["adds", "R += i;"],
  ["steps", "R++;"],
  ["steps-back", "--R;"],
  ["assigns", "R = i;"],
  ["assigns-double", "R = i * 0.5;"],
  ["assigns-text", 'R = "i" + i;'],
  ["read-and-add", "sum += R;"],
  ["read-twice", "sum += R + R;"],
  ["read-write-read", "sum += R;\nR = i;\nsum += R;"],
  ["by-turns", "if (i & 1) R = i;\nelse sum += R;"],
  ["condition", "if (R > 1) sum++;\nR += 1;"],
  ["bound", "if (i < R) sum++;"],
  ["compound", "R = (R * 3 + i) | 0;"],
  ["appends", 'R += "," + i;'],
  ["or", "R ||= i + 1;"],
  ["nullish", "R ??= i + 1;"],
  ["kept-in-a-call", "sum += read();\nR = i;"],
  ["compared", "if (R === i) sum += 10;\nR = i + 1;"],
  ["reads-method", "held = S.bump;\nR = i;"],
  ["reads-idle-method", "R = i;\nheld = S.idle;\nsum += R;"],
  ["calls-method", "R = i;\nS.bump?.(i);"],
  ["calls-and-reads", "sum += R;\nS.bump?.(i);\nsum += R;"],
  ["calls-idle", "R += i;\nsum += S.idle?.() ?? 2;"],
  ["prototype", "held = S.prototype;\nR = i;"],
  ["instance", 'R = i;\nif (typeof S === "function") sum += new S().ask?.() ?? 3;'],
  ["passes-the-class", "take(S);\nR = i;\ntake(S);"],
  ["keys", "R = i;\nsum += Object.keys(S).length;"],
  ["name", "R = i;\nheld = S.name;"],
  ["other-static", "R = i;\nsum += S.w ?? 4;"],
  ["kept-class", "held = S;\nR = i;"],
  ["push", "R.push?.(i);\nsum += R.length ?? 1;"],
];
// `touch()` is called in the loop; it may touch the static.
const others: [name: string, text: string][] = [
  ["nobody", ""],
  ["reads", "touch = () => void notes.push(show(R));"],
  ["writes", "touch = () => void (R = 7);"],
  ["writes-text", 'touch = i => void (i === 2 && (R = "w"));'],
  ["throws", 'touch = i => {\n  if (i === 2) throw new RangeError("t");\n};'],
  ["steps-too", "touch = () => void R++;"],
  ["deletes", "touch = i => {\n  if (i === 2) remove();\n};"],
  ["defines", "touch = i => {\n  if (i === 2) redefine();\n};"],
];
const loops: [name: string, text: string][] = [
  ["counted", "for (let i = 0; i < n; i++) {\n  touch(i);\n  USE\n}"],
  ["touched-behind", "for (let i = 0; i < n; i++) {\n  USE\n  touch(i);\n}"],
  ["untouched", "for (let i = 0; i < n; i++) {\n  USE\n}"],
  ["nested", "for (let k = 0; k < 2; k++)\n  for (let i = 0; i < n; i++) {\n    USE\n    if (k) touch(i);\n  }"],
  ["while", "let i = -1;\nwhile (++i < n) {\n  USE\n  if (i === 3) break;\n}"],
  ["of", "for (const i of [0, 1, 2, 3]) {\n  USE\n  touch(i);\n}"],
  ["callback", "[0, 1, 2, 3].forEach(i => {\n  USE\n  touch(i);\n});"],
  [
    "tried",
    "for (let i = 0; i < n; i++) {\n  try {\n    USE\n    touch(i);\n  } catch (error) {\n    notes.push(error.name);\n  }\n}",
  ],
  ["function", "const step = i => {\n  USE\n};\nfor (let i = 0; i < n; i++) step(i);\ntouch(1);"],
  ["bound-is-static", "for (let i = 0; i < 6 && !(R > 100); i++) {\n  USE\n}"],
];
const total = statics.length * values.length * uses.length * others.length * loops.length * bumps.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const fixed = pick(statics);
  const value = pick(values);
  const use = pick(uses);
  const other = pick(others);
  const loop = pick(loops);
  const bump = pick(bumps);
  const isTyped =
    cell % 3 === 1 && !["late", "of-a-function", "getter-alone"].includes(fixed[0]) && !/\bS\b/.test(use[1]);
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const reach = fixed[1];
  const at = (text: string) => text.replaceAll(/\bR\b/g, () => reach);
  const type = (text: string) => (isTyped ? text : "");
  const typed = (text: string) => isTyped ? text.replaceAll("(error)", "(error: any)").replaceAll(/\bi =>/g, "(i: number) =>").replaceAll("() =>", "(): any =>").replaceAll(/static (v|kept) =/g, "static $1: any =").replaceAll("set v(value)", "set v(value: any)").replaceAll("static get v()", "static get v(): any").replaceAll("const S = {", "const S: any = {").replaceAll("const S = [", "const S: any[] = [").replaceAll("const S = Object", "const S: any = Object").replaceAll("let v =", "let v: any =") : text; // prettier-ignore
  const holder = reach.replace(/(\.v|\["v"\]|\[0\]|\.#v)$/, "");
  const key = reach === "S[0]" ? "0" : '"v"';
  const isPlain = reach === "v" || reach === "S.#v";
  const work = [
    `function work(n${type(": number")})${type(": any")} {`,
    `  let sum${type(": any")} = 0;`,
    indent(typed(at(loop[1].replace("USE", () => use[1]))), "  "),
    "  return [sum, " + reach + "];",
    "}",
  ].join("\n");
  const helpers = [
    `let touch${type(": any")} = (i${type(": number")}) => {};`,
    typed(at(other[1])),
    ...(/\bheld\b/.test(use[1]) ? [`let held${type(": any")};`] : []),
    ...(/\btake\(/.test(use[1])
      ? [
          `const take = (value${type(": any")}) => void (sum2 += typeof value === "function" || typeof value === "object" ? Number(value.v) || 1 : 1);`,
          "let sum2 = 0;",
        ]
      : []),
    ...(/read\(/.test(use[1]) ? [typed(`const read = () => ${reach};`)] : []),
    ...(/remove\(/.test(other[1])
      ? [
          isPlain
            ? "const remove = () => {};"
            : `const remove = () => void delete (${holder}${type(" as any")})[${key}];`,
        ]
      : []),
    ...(/redefine\(/.test(other[1])
      ? [
          isPlain
            ? "const redefine = () => {};"
            : `const redefine = () => void Object.defineProperty(${holder}, ${key}, { configurable: true, get: () => 50, set() {} });`,
        ]
      : []),
  ].filter(Boolean);
  const before = typed(fixed[2])
    .replaceAll("VALUE", () => value[1])
    .replaceAll("BUMP", () => bump[1]);
  // A private static is reached from inside its class alone.
  const body = fixed[0] === "private" ? [`class S {\n  static #v${type(": any")} = ${value[1]};\n  static run(n${type(": number")})${type(": any")} {`, indent(helpers.join("\n"), "    "), indent(work, "    "), "    return work(n);\n  }\n}", "const work = S.run;"] : [before, ...(isTyped && /^class S \{\}|^function S/.test(fixed[2]) ? [] : []), ...helpers, work]; // prettier-ignore
  const lines = [
    `const notes${type(": any[]")} = [];`,
    `const show = (value${type(": any")})${type(": string")} => (Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : typeof value === "object" && value ? JSON.stringify(value) : String(value));`,
    ...body.map(text => (isTyped && /^(class S \{\}|function S)/.test(text) ? text.replaceAll("S.v =", "(S as any).v =") : text)),
    "for (const n of [4, 0, 6]) {",
    "  try {",
    "    notes.push(show(work(n)));",
    "  } catch (error) {",
    `    notes.push((error${type(" as any")}).name);`,
    "  }",
    "}",
    'console.log(notes.join(" ").slice(0, 600));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${fixed[0]}--${value[0]}--${use[0]}--${other[0]}--${loop[0]}.${isTyped ? "ts" : "mjs"}`,
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

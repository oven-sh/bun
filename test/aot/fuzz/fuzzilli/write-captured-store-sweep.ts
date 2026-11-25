// Stores into a captured variable with a call of a closure between them: what two closures do, times how a variable comes to hold one of them, times the stores around the call, times the loop, times the variable, times the function around.
//
//   bun write-captured-store-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<first>--<second>--<holder>--<stores>--<loop>--<variable>--<function>.mjs, .cjs or .ts
//   bun write-captured-store-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `sum` is the captured variable, `other` a second one.
const closures: [name: string, text: string][] = [
  ["reads", "() => sum"],
  ["doubles", "() => sum * 2"],
  ["steps", "() => (sum += 1)"],
  ["writes", "() => {\n  sum = 7;\n  return 1;\n}"],
  ["length", "() => seen.length"],
  ["constant", "() => 5"],
  ["other", "() => other"],
  ["function", "function () {\n  return sum;\n}"],
  ["through", "() => inner()"],
  ["pushes", "() => seen.push(sum)"],
  ["throws", "() => {\n  if (sum > 3) throw new RangeError('c');\n  return sum;\n}"],
];
// `A` and `B` are the closures; `limit` is 0 or 1.
const holders: [name: string, text: string][] = [
  ["loop-in-front", "let get = A;\nfor (let i = 0; i < limit; i++) get = B;"],
  ["branch", "let get = A;\nif (limit) get = B;"],
  ["choice", "const get = limit ? B : A;"],
  ["element", "const get = [A, B][limit];"],
  ["field", "const box = { get: A };\nif (limit) box.get = B;\nconst get = box.get;"],
  ["both-fields", "const box = { one: A, two: B };\nconst get = limit ? box.two : box.one;"],
  ["nullish", "let get;\nif (limit) get = B;\nget ??= A;"],
  ["table", "const get = new Map([[0, A], [1, B]]).get(limit);"],
  ["switch", "let get;\nswitch (limit) {\n  case 0:\n    get = A;\n    break;\n  default:\n    get = B;\n}"],
  ["returned", "const choose = which => (which ? B : A);\nconst get = choose(limit);"],
  ["in-turn", "let get = A;\nconst later = B;"],
  ["one", "const get = A;"],
  ["pushed", "const kept = [];\nkept.push(A);\nif (limit) kept.push(B);\nconst get = kept[kept.length - 1];"],
  ["handed", "const get = hand(limit ? B : A);"],
  ["caught", "let get = A;\ntry {\n  if (limit) throw 1;\n} catch {\n  get = B;\n}"],
];
const stores: [name: string, text: string][] = [
  ["added", "sum += 2;\nsum += get();"],
  ["set-then-added", "sum = i * 10;\nsum = sum + get();"],
  ["set-asked-set", "sum = i;\nother = get();\nsum = 3;"],
  ["stepped", "sum++;\nconst now = get();\nsum = now;"],
  ["twice-set", "sum = 1;\nsum = 2;\nother += get();\nsum = 4;"],
  ["sometimes", "if (i & 1) sum = i;\nsum += get();"],
  ["asked-first", "sum = get();\nsum = get() + 1;"],
  ["asked-twice", "sum += get() + get();"],
  ["caught", "try {\n  sum = i;\n  fail(i);\n  sum = 7;\n} catch {\n  other += get();\n}\nsum = 1;"],
  ["finally", "try {\n  sum = i;\n} finally {\n  sum = sum | 0;\n  sum ^= 3;\n}\nother = get();"],
  ["callback", "sum = i;\n[1, 2].forEach(() => (other += get()));\nsum = 0;"],
  ["helper", "sum = i;\nother = ask(get);\nsum = -1;"],
  ["pair", "[sum, other] = [i, get()];"],
  ["text", "sum = i;\nother = `${get()}`.length;\nsum += 1;"],
  ["taken-back", "const old = sum;\nsum = old + 1;\nother = get?.();\nsum = old;"],
  ["getter", "sum = i;\nother = { get v() { return get(); } }.v;\nsum = 2;"],
  ["sorted", "sum = i;\n[2, 1].sort(() => get());\nsum = 5;"],
  ["nothing-behind", "sum = i;\nother = get();"],
  ["element", "seen[0] = sum;\nsum = seen[0] + 1;\nother = get();\nsum = seen.length;"],
  ["converted", "sum = i;\nother = +{ valueOf: () => get() };\nsum = 6;"],
];
// `STEP` in a turn; `i` counts.
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < 5; i++) {\n  STEP\n}"],
  ["while", "let i = 0;\nwhile (i < 4) {\n  STEP\n  i++;\n}"],
  ["by-itself", "let i = 0;\nwhile (sum < 10 && i++ < 9) {\n  STEP\n}"],
  ["once", "const i = 2;\n{\n  STEP\n}"],
  ["of", "for (const i of [3, 1, 2]) {\n  STEP\n}"],
  ["callback", "[0, 1, 2].forEach(i => {\n  STEP\n});"],
  ["recursive", "const turn = i => {\n  if (i > 3) return;\n  STEP\n  turn(i + 1);\n};\nturn(0);"],
  ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 3; i++) {\n    STEP\n  }\n}"],
  ["do", "let i = 0;\ndo {\n  STEP\n} while (++i < 4);"],
  ["breaks", "for (let i = 0; ; i++) {\n  STEP\n  if (i > 3 || sum > 40) break;\n}"],
];
const variables: [name: string, text: string][] = [
  ["integer", "0"],
  ["double", "0.5"],
  ["text", '""'],
  ["nothing", "undefined"],
  ["given", "given"],
];
// `BODY` is what is done with `limit` and `given`.
const functions: [name: string, text: string][] = [
  ["function", "function run(limit, given) {\n  BODY\n}"],
  ["arrow", "const run = (limit, given) => {\n  BODY\n};"],
  ["async", "async function run(limit, given) {\n  await null;\n  BODY\n}"],
  [
    "method",
    "const holder = {\n  run(limit, given) {\n    BODY\n  },\n};\nconst run = (limit, given) => holder.run(limit, given);",
  ],
  [
    "generator",
    "function* steps(limit, given) {\n  yield limit;\n  BODY\n}\nconst run = (limit, given) => [...steps(limit, given)].length;",
  ],
  ["in-block", "function run(limit, given) {\n  for (let round = 0; round < 2; round++) {\n    BODY\n  }\n}"],
];
const total = closures.length ** 2 * holders.length * stores.length * loops.length * variables.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const store = pick(stores);
  const holder = pick(holders);
  const first = pick(closures);
  const second = pick(closures);
  const loop = pick(loops);
  const form = pick(functions);
  const variable = pick(variables);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0 && form[0] !== "async";
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const step = holder[0] === "in-turn" ? `if (i === 2 && limit) get = later;\n${store[1]}` : store[1];
  const body = [
    `let sum = ${variable[1]};`,
    "let other = 1;",
    "const seen = [];",
    ...(/inner/.test(first[1] + second[1]) ? ["const inner = () => sum;"] : []),
    holder[1].replaceAll(/\b[AB]\b/g, letter => (letter === "A" ? first[1] : second[1])),
    within(loop[1], "STEP", step),
    "out.push(show(sum), show(other), seen.join('/'));",
  ].join("\n");
  const call = form[0] === "async" ? "await run(limit, given);" : "run(limit, given);";
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 30));',
    "const out = [];",
    ...(/hand\(/.test(body) ? ["const hand = value => value;"] : []),
    ...(/ask\(/.test(body) ? ["const ask = given => given();"] : []),
    ...(/fail\(/.test(body) ? ["const fail = value => {\n  if (value & 1) throw new Error('f');\n};"] : []),
    within(form[1], "BODY", body),
    "for (const [limit, given] of [[0, 0], [1, 2], [1, 0.5]]) {",
    "  try {",
    `    ${call}`,
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${first[0]}--${second[0]}--${holder[0]}--${store[0]}--${loop[0]}--${variable[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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

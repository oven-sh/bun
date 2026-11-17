// Pushes in loops inside loops: the list, times the outer loop, times the inner loop, times what is pushed in it, times what is pushed around it, times the values, times what else is done, times how the list is read, times the function around.
//
//   bun write-nested-push-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<list>--<outer>--<inner>--<pushed>--<around>--<value>--<besides>--<read>--<function>.mjs, .cjs or .ts
//   bun write-nested-push-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `out` is the list that is pushed onto.
const lists: [name: string, text: string][] = [
  ["literal", "const out = [];"],
  ["of-one", "const out = [0];"],
  ["of-text", "const out = ['s'];"],
  ["of-double", "const out = [0.5];"],
  ["let", "let out = [];"],
  ["constructed", "const out = new Array();"],
  ["field", "const box = { out: [] };\nconst { out } = box;"],
  ["per-iteration", "let out = [];\nkept.push(out);"],
  ["captured", "const out = [];\nconst size = () => out.length;"],
  ["given", "const out = given;"],
  ["two", "const out = [];\nconst other = [];"],
  ["emptied", "const out = [1, 2, 3];\nout.length = 0;"],
];
// INNER is the inner loop with what is around it; `i` counts.
const outers: [name: string, text: string][] = [
  ["three", "for (let i = 0; i < 3; i++) {\n  INNER\n}"],
  ["given", "for (let i = 0; i < n; i++) {\n  INNER\n}"],
  ["of", "for (const i of [0, 1, 2]) {\n  INNER\n}"],
  ["while", "let i = 0;\nwhile (i < 3) {\n  INNER\n  i++;\n}"],
  ["down", "for (let i = 3; i-- > 0; ) {\n  INNER\n}"],
  ["once", "{\n  const i = 1;\n  INNER\n}"],
  ["two-loops", "for (let i = 0; i < 2; i++) {\n  INNER\n}\nfor (let i = 0; i < 2; i++) {\n  INNER\n}"],
  ["callback", "[0, 1, 2].forEach(i => {\n  INNER\n});"],
  ["of-list", "for (let i = 0; i < l.length; i++) {\n  INNER\n}"],
  ["do", "let i = 0;\ndo {\n  INNER\n} while (++i < 3);"],
];
// PUSH is what is pushed; `q` counts.
const inners: [name: string, text: string][] = [
  ["two", "for (let q = 0; q < 2; q++) PUSH"],
  ["four", "for (let q = 0; q < 4; q++) PUSH"],
  ["given", "for (let q = 0; q < n; q++) PUSH"],
  ["to-outer", "for (let q = 0; q <= i; q++) PUSH"],
  ["from-outer", "for (let q = i; q < 3; q++) PUSH"],
  ["of-list", "for (let q = 0; q < l.length; q++) PUSH"],
  ["of", "for (const q of l) PUSH"],
  ["while", "let q = 0;\nwhile (q < 3) {\n  PUSH\n  q++;\n}"],
  ["by-two", "for (let q = 0; q < 6; q += 2) PUSH"],
  ["down", "for (let q = 2; q >= 0; q--) PUSH"],
  ["breaks", "for (let q = 0; q < 5; q++) {\n  if (q === 2) break;\n  PUSH\n}"],
  ["continues", "for (let q = 0; q < 4; q++) {\n  if (q === 1) continue;\n  PUSH\n}"],
  ["none", "const q = 1;\nPUSH"],
  ["twice", "for (let q = 0; q < 2; q++) PUSH\nfor (let q = 0; q < 2; q++) PUSH"],
  ["deeper", "for (let k = 0; k < 2; k++) for (let q = 0; q < 2; q++) PUSH"],
];
// V is the value.
const pushes: [name: string, text: string][] = [
  ["one", "out.push(V);"],
  ["two", "out.push(V, q);"],
  ["at-length", "out[out.length] = V;"],
  ["if", "if (q !== 1) out.push(V);"],
  ["either", "if (i & 1) out.push(V);\nelse out.push(q);"],
  ["after-read", "out.push(out.length ? out[out.length - 1] : V);"],
  ["kept-length", "lengths.push(out.push(V));"],
  ["spread", "out.push(...[V, q]);"],
  ["list", "out.push([V]);"],
  ["in-front", "out.unshift(V);"],
];
// Around the inner loop.
const around: [name: string, text: string][] = [
  ["behind", "LOOP\nout.push(V);"],
  ["nothing", "LOOP"],
  ["in-front", "out.push(V);\nLOOP"],
  ["both", "out.push(i);\nLOOP\nout.push(V);"],
  ["another-list", "LOOP\nlengths.push(out.length);"],
  ["popped", "LOOP\nout.pop();"],
  ["if-behind", "LOOP\nif (i === 1) out.push(V);"],
  ["handed", "LOOP\nsee(out);"],
  ["shortened", "LOOP\nif (i === 1) out.length = 1;"],
  ["caught", "try {\n  LOOP\n  if (i === 1) throw 1;\n} catch {\n  out.push(V);\n}"],
];
const values: [name: string, text: string][] = [["element", "l[c]"], ["counter", "i"], ["inner-counter", "q0"], ["double", "i + 0.5"], ["text", "'t' + i"], ["object", "held"], ["either", "(i & 1 ? 0.5 : i)"], ["moving-element", "l[i % 3]"], ["nothing", "undefined"], ["product", "l[c] * 0.5"]]; // prettier-ignore
// Stands in front of the outer loop or in each of its iterations.
const besides: [name: string, text: string][] = [["nothing", ""], ["store", "l[2 - c] = i;"], ["store-of-double", "l[c] = i + 0.5;"], ["call", "see(l);"], ["sum", "sum += l[c];"], ["loop", "for (let k = 0; k < 2; k++) sum += k;"], ["fails", "fail(i);"]]; // prettier-ignore
const reads: [name: string, text: string][] = [["joined", "out.join()"], ["json", "JSON.stringify(out)"], ["length", "out.length + ':' + lengths.join()"], ["held", "Array.from(out, (x, k) => (k in out ? show(x) : 'hole')).join()"], ["sum", "out.reduce((all, x) => all + (+x || 0), 0)"]]; // prettier-ignore
const functions: [name: string, text: string][] = [
  ["function", "function run(c, n, given) {\n  BODY\n}"],
  ["arrow", "const run = (c, n, given) => {\n  BODY\n};"],
  [
    "method",
    "class Runner {\n  run(c, n, given) {\n    BODY\n  }\n}\nconst run = (c, n, given) => new Runner().run(c, n, given);",
  ],
];
const total = lists.length * outers.length * inners.length * pushes.length * around.length * values.length * besides.length * reads.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const inner = pick(inners);
  const frame = pick(around);
  const value = pick(values);
  const outer = pick(outers);
  const push = pick(pushes);
  const beside = pick(besides);
  const list = pick(lists);
  const read = pick(reads);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const inLoop = push[1].replaceAll(/\bV\b/g, value[1].replace("q0", "q"));
  const block = inLoop.includes("\n") ? `{\n${indent(inLoop, "  ")}\n}` : inLoop;
  const loop = inner[1].replaceAll(
    /^( *)(.*)PUSH$/gm,
    (_, by, front) => by + front + indent(front ? block : inLoop, by).trimStart(),
  );
  const work = `{\n${indent(within(frame[1].replaceAll(/\bV\b/g, value[1].replace("q0", "i")), "LOOP", loop), "  ")}\n}`;
  const isPerIteration = list[0] === "per-iteration";
  const turn = [isPerIteration ? list[1] : "", beside[1], work, isPerIteration ? `seen.push(${read[1]});` : ""].filter(Boolean).join("\n"); // prettier-ignore
  const any = isTyped ? ": any" : "";
  const body = [
    `const l${any} = [1, 2, 3];\nconst lengths = [];\nconst kept = [];\nconst seen = [];\nlet sum = 0;`,
    ...(isPerIteration ? [] : [list[1]]),
    ...(beside[0] === "fails"
      ? [`try {\n${indent(within(outer[1], "INNER", turn), "  ")}\n} catch (error) {\n  seen.push(error.name);\n}`]
      : [within(outer[1], "INNER", turn)]),
    `return ${isPerIteration ? "seen.join(';') + kept.length" : read[1]} + '/' + seen.length + '/' + sum;`,
  ].join("\n");
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : String(value).slice(0, 14));',
    "let calls = 0;",
    ...(/see\(/.test(body) ? ["const see = list => list.length;"] : []),
    ...(/fail\(/.test(body) ? ["const fail = i => {\n  if (calls++ % 4 === 2) throw new Error('f' + i);\n};"] : []),
    ...(/\bheld\b/.test(body) ? ["const held = { toString: () => 'h' };"] : []),
    within(form[1], "BODY", body),
    "for (let turn = 0; turn < 2; turn++) {",
    "  for (const [c, n] of [[0, 2], [1, 5], [2, 1]]) {",
    "    console.log(run(c, n, []));",
    "  }",
    "}",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${list[0]}--${outer[0]}--${inner[0]}--${push[0]}--${frame[0]}--${value[0]}--${beside[0]}--${read[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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

// A loop with a second counter that is changed out of turn: what changes it, times when, times around what the change stands (an await, a yield, a call, a loop within the loop, a handler), times its ordinary step, times what it is read for, times the loop, times what it counts in.
//
//   bun write-second-counter-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<change>--<around>--<step>--<use>--<loop>--<list>.ts or .mjs
//   bun write-second-counter-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `n` is the second counter, `i` the first, `k` a parameter.
const changes: [name: string, text: string][] = [
  ["plus", "n += k | 0;"],
  ["minus", "n -= k;"],
  ["set", "n = k;"],
  ["set-written", "n = 100;"],
  ["set-below", "n = -5;"],
  ["zero", "n = 0;"],
  ["doubled", "n *= 2;"],
  ["halved", "n /= 2;"],
  ["first-counter", "n = i;"],
  ["length", "n = list.length;"],
  ["two-steps", "n++;\nn++;"],
  ["back", "n--;"],
  ["element", "n += list[0] | 0;"],
  ["swapped", "[n, m] = [m, n];"],
  ["closure", "jump();"],
  ["wide", "n += 2 ** 31;"],
  ["fraction", "n += 0.5;"],
  ["nothing", ""],
];
const conditions: [name: string, text: string][] = [
  ["third", "i === 2"],
  ["odd", "i & 1"],
  ["past", "n > 3"],
  ["parameter", "k > 5"],
  ["last", "i === 7"],
  ["always", "true"],
];
// `C` is the change; `WAIT` a way of the function that waits.
const arounds: [name: string, text: string, kind: "plain" | "async" | "generator"][] = [
  ["nothing", "C", "plain"],
  ["await-before", "await null;\nC", "async"],
  ["await-behind", "C\nawait null;", "async"],
  ["awaited-call", "await later();\nC", "async"],
  ["for-await", "for await (const value of [1, 2]) {\nC\n}", "async"],
  ["yield", "yield n;\nC", "generator"],
  ["yield-behind", "C\nyield n;", "generator"],
  ["call", "pass(n);\nC", "plain"],
  ["inner-loop", "for (let j = 0; j < 2; j++) {\nC\n}", "plain"],
  ["inner-while", "let j = 0;\nwhile (j++ < 3) {\nC\n}", "plain"],
  ["inner-unknown", "for (let j = 0; j < k; j += 40) {\nC\n}", "plain"],
  ["for-of", "for (const value of [5, 6]) {\nC\nm += value;\n}", "plain"],
  ["try", "try {\nC\n} catch {\nm++;\n}", "plain"],
  ["thrown", 'try {\nif (k > 5) throw new Error("x");\nm++;\n} catch {\nC\n}', "plain"],
  ["finally", "try {\npass(n);\n} finally {\nC\n}", "plain"],
  ["block", "out: {\nif (k < 0) break out;\nC\n}", "plain"],
  ["switch", "switch (k) {\ncase 3:\nn++;\nbreak;\ndefault:\nC\n}", "plain"],
  ["callback", "[1].forEach(() => {\nC\n});", "plain"],
  ["continue", "C\nif (k === 100) continue;", "plain"],
];
const steps: [name: string, text: string][] = [
  ["in-a-store", "out[n++] = i;"],
  ["in-a-view-store", "view[n++] = i + 1;"],
  ["in-a-read", "sum += list[n++] ?? 100;"],
  ["alone", "n++;"],
  ["by-two", "n += 2;"],
  ["by-parameter", "n += step;"],
  ["sometimes", "if (i % 2 === 0) n++;"],
  ["down", "n--;"],
  ["in-a-view-read", "sum += doubles[n++] === undefined ? 1000 : 1;"],
];
const uses: [name: string, text: string][] = [
  ["compared", "if (n > 50) sum += 10;\nif (n < 0) sum += 100;"],
  ["element", "sum += list[n] ?? 1000;"],
  ["view", "sum += view[n] ?? 2000;"],
  ["doubles", "sum += doubles[n] ?? 3000;"],
  ["character", "sum += text.charCodeAt(n) | 0;"],
  ["stored", "out[n] = i;"],
  ["view-stored", "view[n] = i;\nsum += view.length;"],
  ["chosen", "sum += n < 8 ? 1 : 20;"],
  ["bits", "sum ^= 1 << n;"],
  ["shown", 'said += n + ",";'],
  ["integer", "sum += Number.isInteger(n) ? 1 : 50;"],
  ["in-range", "if (n >= 0 && n < list.length) sum += list[n];\nelse sum += 5000;"],
  ["least", "sum += Math.min(n, 9) + Math.max(n, -3);"],
  ["equal", "sum += n === i ? 1 : 7;"],
];
const loops: [name: string, text: string][] = [
  ["up", "for (let i = 0; i < 8; i++) {\nBODY\n}"],
  ["down", "for (let i = 7; i >= 0; i--) {\nBODY\n}"],
  ["two-in-the-head", "for (let i = 0; i < 8; i++, m++) {\nBODY\n}"],
  ["while", "let i = -1;\nwhile (++i < 8) {\nBODY\n}"],
  ["list", "for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) {\nBODY\n}"],
  ["nest", "for (let r = 0; r < 2; r++) {\nfor (let i = 0; i < 8; i++) {\nBODY\n}\n}"],
  ["unknown", "for (let i = 0; i < list.length; i++) {\nBODY\n}"],
];
const lists = ["[1, 2, 3, 4, 5, 6, 7, 8]", "[0.5, 1, 2, 3, 4, 5, 6, 7]", "new Int32Array(16).fill(3)", "new Array(8).fill(2)"] as const; // prettier-ignore
const orders = ["change-step-use", "use-change-step", "step-use-change", "change-use-step"] as const;
const total = changes.length * conditions.length * arounds.length * steps.length * uses.length * loops.length * lists.length * orders.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const around = pick(arounds);
  const change = pick(changes);
  const use = pick(uses);
  const step = pick(steps);
  const condition = pick(conditions);
  const loop = pick(loops);
  const list = pick(lists);
  const order = pick(orders);
  const isTyped = cell % 2 === 0;
  const t = (type: string) => (isTyped ? type : "");
  const turn = condition[0] === "always" ? around[1].replace("C", () => change[1]) : `if (${condition[1]}) {\n${around[1].replace("C", () => change[1])}\n}`; // prettier-ignore
  const parts: Record<string, string> = { change: turn, step: step[1], use: use[1] };
  // A counter that goes back for ever ends.
  const body = ["if (--fuel < 0) break;", ...order.split("-").map(part => parts[part]!)].join("\n");
  const head = around[2] === "async" ? "async function" : around[2] === "generator" ? "function*" : "function";
  const answer = around[2] === "async" ? "Promise<any>" : around[2] === "generator" ? "any" : "any";
  const call = (k: string) => (around[2] === "async" ? `await run(${k})` : around[2] === "generator" ? `[...run(${k})].pop()` : `run(${k})`); // prettier-ignore
  const lines = [
    `const later = async () => {\n  await null;\n};`,
    `const pass = (value${t(": number")}) => value;`,
    `${head} run(k${t(": number")}, step = 1)${t(`: ${answer}`)} {`,
    `  const list${t(list.startsWith("new Int32Array") ? "" : ": number[]")} = ${list};`,
    `  const view = new Uint8Array(16);`,
    `  const doubles = new Float64Array(16);`,
    `  const text = "abcdefghijklmnop";`,
    `  const out${t(": number[]")} = [];`,
    `  let n = 0;`,
    `  let m = 1;`,
    `  let sum = 0;`,
    `  let said = "";`,
    `  let fuel = 40;`,
    ...(change[0] === "closure" ? [`  const jump = () => {\n    n += k;\n  };`] : []),
    ...loop[1].replace("BODY", () => body).split("\n").map(line => "  " + line), // prettier-ignore
    `  ${around[2] === "generator" ? "yield" : "return"} [sum, n, m, said, out.length, Object.keys(out).slice(0, 9).join(), view.join(), doubles.join()].join("|");`,
    `}`,
    `const k = JSON.parse("12");`,
    ...["100", "-10", "3", "k", "JSON.parse(\"0.5\")"].map(value => `console.log(${call(value)});`),
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${change[0]}--${around[0]}--${step[0]}--${use[0]}--${loop[0]}--${condition[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.filter(line => line.trim()).join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(8, "0");
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

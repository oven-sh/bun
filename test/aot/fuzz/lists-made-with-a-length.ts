// `const list = new Array(n); for (let k = 0; k < n; k++) list[k] = ..`: a list made with a length and filled in a loop. A compiler
// may take n for the list's length, read it from n and let one bounds test stand for the comparison, as long as the list did
// nothing on any way to the comparison that could change its length. Each scene varies that: the length that arrives (zero, a
// fraction, negative, text), what happens to the list before and inside the loop (it grows, shrinks, is handed on, frozen, or n
// moves), the loop's head and what is asked of the list behind it.
import type { Random } from "./random";

const lengths = ["0", "1", "2", "5", "5", "8", "64", "given", "given", "given + 1", "given >> 1"];
const strangeLengths = ["0.5", "-1", 'word("3")', "2 ** 32", "NaN", "true", "null"];

const makers = [
  "[]",
  "[]",
  "new Array()",
  "new Array(n)",
  "new Array(n)",
  "new Array(n)",
  "Array(n)",
  "new Array(n) as LIST",
];

const before = [
  "list.length = 2;",
  "list.length = n + 3;",
  "list.push(1);",
  "list.pop();",
  "list.shift();",
  "list[n] = 1;",
  "list[n + 2] = 1;",
  "n++;",
  "n--;",
  "handOn(list);",
  "handOn(list, turn);",
  'list[0] = "first";',
  "list = [1, 2];",
  "list = new Array(n + 1);",
  "Object.freeze(list);",
  "Object.seal(list);",
  'Object.defineProperty(list, "length", { writable: false });',
  'Object.setPrototypeOf(list, { 0: "inherited", 1: "inherited" });',
  "kept = list;",
];

const heads = [
  "let k = 0; turns++ < n; k++",
  "let k = 0; turns++ < 16; k++",
  "let k = 0; turns++ < n; k += 2",
  "let k = 0; k < n && turns++ < 16; k++",
  "let k = 0; list.push(k), k < n; k++",
  "let k = 0; list.push(() => k), k < n; k++",
  "let k = 0; k < n; list.push(k), k++",
  "let k = list.push(0); k < n; k++",
  "let k = 0; k < n; k++",
  "let k = 0; k < n; k++",
  "let k = 0; k < n; k++",
  "let k = 0; k < list.length; k++",
  "let k = 0; k < list.length; k++",
  "let k = 0; k <= n - 1; k++",
  "let k = 0; n > k; k++",
  "let k = 0; k !== n && k < 200; k++",
  "let k = n - 1; k >= 0; k--",
  "let k = 0; k < n; k += 2",
  "let k = 1; k < n; k++",
  "let k = 0; k < list.length && k < n; k++",
];

const bodies = [
  "if (k === 1) list = [];\n      list.push(k);",
  "list.push(k);\n      if (k === 2) list = [];",
  "if (turn % 3 === 0 && k === n >> 1) list = [];\n      list.push(k * 2);",
  "if (k % 2) list = [k];\n      list.push(k);",
  "if (k === n >> 1) continue; list.push(k);",
  "if (k === 0) continue; list.push(k);",
  "if (k % 2) continue; list.push(() => k);",
  "list.push(k);",
  "list.push(k);",
  "list.push(k * 2);",
  "list.push(0.5);",
  'list.push(k % 2 ? k : "text");',
  "list.push(k); list.push(k);",
  "if (k % 3 !== 2) list.push(k);",
  "list[k] = k * 2;",
  "list[k] = k * 2;",
  "list[k] = k * 2;",
  "list[k] = 0.5;",
  'list[k] = k % 2 ? k : "text";',
  "list[k] = { at: k };",
  "said += String(list[k]) + ','; list[k] = k;",
  "said += String(list[k]) + ',';",
  "list[k] = list[k - 1];",
  "if (k % 3 === 2) continue; list[k] = k;",
  "if (k === 3) break; list[k] = k;",
  "list[k + 1] = k;",
  "list[k] = k; if (turn % 7 === 6 && k === 1) list.length = 1;",
  "list[k] = k; if (turn % 7 === 6 && k === 1) list.push(9);",
  "list[k] = k; if (turn % 7 === 6 && k === 1) n = 2;",
  "list[k] = k; if (turn % 7 === 6) handOn(list, turn);",
  'if (turn % 7 === 6 && k === 2) throw new RangeError("rare"); list[k] = k;',
  "list[k] = list.length;",
  "list[k] = n;",
];

const asks = [
  'list.map(each => (typeof each === "function" ? each() : each)).join()',
  "[...list].map(each => typeof each + String(each)).join()",
  "[...list].map(each => typeof each + String(each)).join()",
  "list.slice().map(each => typeof each + String(each)).join()",
  "list.slice().map(each => typeof each + String(each)).join()",
  "JSON.stringify([...list])",
  "Array.from(list).map(each => each === true).join()",
  "[...list][n - 1]",
  "list.slice(0)[n >> 1]",
  "list.length",
  "list.length",
  "n",
  "JSON.stringify(list)",
  "Object.keys(list).length",
  'list.join("|")',
  "list.at(-1)",
  "0 in list",
  "n - 1 in list",
  "list[n - 1]",
  "list[n]",
  "list.indexOf(undefined)",
  "list.includes(undefined)",
  "list.reduce((sum, each) => sum + 1, 0)",
  "Array.isArray(list)",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const failure = typed ? "(error as Error).name" : "error.name";
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.4);
    const length = !isPlain && random.chance(0.15) ? random.pick(strangeLengths) : random.pick(lengths);
    const isStrange = strangeLengths.includes(length);
    const isNumber = !strangeLengths.includes(length) || !["word", "true", "null"].some(each => length.includes(each));
    const start = isNumber || !typed ? length : `(${length} as unknown as number)`;
    const made = random.pick(makers).replace(" as LIST", typed ? " as any[]" : "");
    const change = isPlain || random.chance(0.45) ? "" : random.pick(before);
    const seldom = random.pick([1, 1, 3, 11]);
    const head = isPlain
      ? random.pick([
          "let k = 0; k < n; k++",
          "let k = 0; list.push(() => k), k < n; k++",
          "let k = 0; list.push(k), k < n; k++",
        ])
      : random.pick(heads);
    const body = head.includes("push")
      ? random.pick(["", "said += k;", "held += k;"])
      : isPlain
        ? random.pick(bodies.slice(0, 15))
        : random.pick(bodies);
    const asked = [random.pick(asks.slice(0, 9)), ...random.sample(asks, random.between(0, 2))];
    const turns = random.pick([6, 40, 300, 3000]);
    // Bare: a constant empty list, a bound that is small by itself and no way out of the loop, as people write it.
    const pushesInHead =
      head.includes("push") || (body.includes("push") && !head.includes("list.length") && random.chance(0.7));
    const start2 = pushesInHead && !isStrange ? "given" : start;
    const made2 = pushesInHead ? "[]" : made;
    const keyword = pushesInHead && !isStrange ? "const" : "let";
    const isWrapped = !isPlain && random.chance(0.2);
    // A coroutine's body is compiled as a worker of its own, where a counter may have another type than in a plain function.
    const form = random.pick(["plain", "plain", "plain", "generator", "generator", "async"]);
    const pause = random.chance(0.4) ? (form === "generator" ? "yield 0;" : form === "async" ? "await null;" : "") : "";
    const call = `fill${scene}(4 + turn % 3, turn)`;
    scenes.push(`${form === "async" ? "async " : ""}function${form === "generator" ? "*" : ""} fill${scene}(given${as("number")}, turn${as("number")})${
      typed
        ? form === "generator"
          ? ": Generator<number, string>"
          : form === "async"
            ? ": Promise<string>"
            : ": string"
        : ""
    } {
  let said = "";
  let turns = 0;
  ${pause}
  ${keyword} n${as("number")} = ${start2};
  ${body.includes("list = ") ? "let" : keyword} list${as("any[]")} = ${pushesInHead || isStrange ? "[]" : made2};
  ${
    isStrange
      ? `try {
    list = ${made};
  } catch (error) {
    return "threw " + ${failure};
  }`
      : ""
  }
  try {
    ${change && !pushesInHead ? `if (turn % ${seldom} === 0) { ${change} }` : ""}
    ${isWrapped ? "let round = 0; do { turns = 0;" : ""}
    for (${head}) {
      ${body.includes("k + 1") || (body.includes("push") && !pushesInHead) ? "if (k > 300) break;" : ""}
      ${body}
    }
    ${isWrapped ? "} while (++round < 2);" : ""}
  } catch (error) {
    said += "threw " + ${failure} + " ";
  }
  try {
    said += [${asked.map(ask => `String(${ask})`).join(", ")}].join(" ");
  } catch (error) {
    said += "threw " + ${failure};
  }
  return said;
}
${form === "async" ? "chain = chain.then(async () => {" : "{"}
  let hash = 0;
  let last = "";
  for (let turn = 0; turn < ${turns}; turn++) {
    last = ${form === "generator" ? `drained(${call})` : form === "async" ? `await ${call}` : call};
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}${form === "async" ? ");" : ""}`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${
    typed ? " as (text: string) => string" : ""
  };
let held = 0;
let chain${as("Promise<void>")} = Promise.resolve();
function drained(steps${as("Generator<number, string>")})${as("string")} {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
let kept${as("any")} = null;
function handOn(list${as("any[]")}, turn${as("number")} = 0) {
  if (turn % 5 === 4) list.length = 1;
  else if (turn % 5 === 3) list.push(7);
  kept = list;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}

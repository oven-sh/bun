// Small functions that make a list of numbers out of their own variables, go on changing the variables and the list, and read the elements right there: what a compiler concludes about how a list is kept must hold at every read.
//
//   numbers   parameters, constants, sums, products, quotients, `| 0`, `>>> 0`, Math.floor, fractions, -0, NaN, numbers near the ends of int32; variables that a later loop carries out of their first range
//   lists     a literal of one to four of them, an empty literal, new Array, Array.of, Array.from, a spread, a slice, a concat, a map; one list or two that are joined by `?:`, by an assignment or by a swap
//   changes   push, a store by index, at the end, one beyond the end, unshift, pop, shift, a length, fill, splice, reverse, sort, `+=` and `++` on an element; whole numbers, then a fraction, then whole numbers again
//   flow      straight on, in a loop, ahead of a loop, behind it, in one arm of an if, in a switch, in a handler, in a finally, in a closure that is called there, behind a yield, behind an await
//   reads     by a constant index, by a variable, by the last index, in a for, in a for-of, by a pattern, by at(), by reduce, by join, sums and products of elements, an element as an index of another list
//
// Nothing leaves the function but what it prints.
import type { Random } from "./random";

const prelude = `function show(x: number | undefined): string {
  return x === undefined ? "u" : Object.is(x, -0) ? "-0" : String(x);
}`;

// `a`, `b`, `c` are the function's number variables, `p` and `q` its parameters.
const numbers = ["p", "q", "a", "b", "c", "a + 1", "a + b", "a - b", "a * 2", "a * b", "a / 2", "b / 4", "a | 0", "a >>> 0", "Math.floor(a / 2)", "Math.round(b)", "a % 3", "-a", "a + 0.5", "0.5", "-0", "7", "0", "-1", "2147483647", "a + 2147483640", "a * 65536", "a * 1e9", "4294967296", "1e21", "NaN", "a - a", "a * 0", "-a * 0", "Math.max(a, b)", "Math.abs(c)", "a ** 2", "a << 4", "c >> 1"];
const advances = ["a += 1;", "a += 6;", "a += b;", "a += x;", "a *= 2;", "a *= 3;", "a -= 7;", "a /= 2;", "a++;", "a--;", "b += 0.5;", "b += a;", "b *= b;", "c = a + b;", "c = c * 31 + a;", "c = (c * 31 + a) | 0;", "a = a * 65536;", "a = -a;", "a %= 5;", "a = a + 1000000000;", "b = b / 3;", "c += 2147483647;", "a <<= 3;", "a >>>= 1;", "[a, b] = [b, a];"];
const makers = [
  "[N]",
  "[N]",
  "[N, N]",
  "[N, N]",
  "[N, N, N]",
  "[N, N, N, N]",
  "[]",
  "[]",
  "new Array<number>()",
  "Array.of(N, N)",
  "Array.from({ length: 3 }, (_, i) => N + i)",
  "[...[N, N]]",
  "[N, N, N].slice(1)",
  "[N].concat([N])",
  "[N, N].map(e => e + N)",
  "[N, N].map(e => e * 2)",
  "new Array<number>(2).fill(N)",
  "[N, N].reverse()",
  "[N, N, N].filter(e => e === e)",
];
// `L` is a list.
const changes = [
  "L.push(N);",
  "L.push(N);",
  "L.push(N);",
  "L.push(N, N);",
  "L[0] = N;",
  "L[1] = N;",
  "L[L.length - 1] = N;",
  "L[L.length] = N;",
  "L[L.length + 1] = N;",
  "L.unshift(N);",
  "L.pop();",
  "L.shift();",
  "L.length = 1;",
  "L.length = 0;",
  "L.length += 1;",
  "L.fill(N);",
  "L.splice(0, 1, N);",
  "L.splice(1, 0, N, N);",
  "L.reverse();",
  "L.sort((l, r) => l - r);",
  "L[0] += N;",
  "L[0]++;",
  "L[0] *= 2;",
  "L[0] /= 2;",
  "L[L.length - 1] -= N;",
  "L.copyWithin(0, 1);",
  "for (let i = 0; i < L.length; i++) L[i] += N;",
  "for (let i = 0; i < L.length; i++) L[i] = L[i] * 2;",
  "for (let i = 0; i < 3; i++) L.push(N + i);",
];
const reads = [
  "out += show(L[0]) + \",\" + show(L[1]) + \" \";",
  "out += show(L[0]) + \",\" + show(L[1]) + \" \";",
  "out += L.length + \":\" + show(L[0]) + \",\" + show(L[L.length - 1]) + \" \";",
  "out += show(L[0] + L[1]) + \" \";",
  "out += show(L[0] * 2) + \",\" + show(L[L.length - 1] / 2) + \" \";",
  "for (let i = 0; i < L.length; i++) out += show(L[i]) + \",\";\n  out += \" \";",
  "for (const e of L) out += show(e) + \",\";\n  out += \" \";",
  "{\n    let sum = 0;\n    for (let i = 0; i < L.length; i++) sum += L[i];\n    out += show(sum) + \" \";\n  }",
  "{\n    let sum = 0;\n    for (const e of L) sum += e;\n    out += show(sum) + \" \";\n  }",
  "{\n    const [first, second] = L;\n    out += show(first) + \",\" + show(second) + \" \";\n  }",
  "out += show(L.at(0)) + \",\" + show(L.at(-1)) + \" \";",
  "out += show(L.reduce((s, e) => s + e, 0)) + \" \";",
  "out += L.join() + \" \";",
  "out += show(L[L.length >> 1]) + \" \";",
  "out += show(L[a & 1]) + \" \";",
  "out += show(L[0] | 0) + \",\" + show(L[1] >>> 0) + \" \";",
  "out += (L[0] === 3 ? \"three\" : L[0] < 3 ? \"less\" : \"more\") + \" \";",
  "out += show(Math.max(L[0], L[1] ?? 0)) + \" \";",
  "out += L.indexOf(L[L.length - 1]) + \",\" + L.includes(N) + \" \";",
  "out += show([10, 20, 30, 40][L[0] & 3]) + \" \";",
  "out += String(L[0]) + typeof L[1] + \" \";",
];

export function generate(random: Random): string {
  const names: string[] = [];
  const text: string[] = [prelude];
  const calls: string[] = [];
  const functions = random.between(6, 14);
  // Half of what goes into a list is a variable as it stands: how the variable is kept is then how the element arrives.
  const number = () => (random.chance(0.5) ? random.pick(["a", "a", "a", "b", "c", "p", "q"]) : random.pick(numbers));
  for (let id = 1; id <= functions; id++) {
    const form = random.weighted([[6, "function"], [2, "generator"], [2, "async"], [1, "method"], [1, "arrow"]] as const);
    // Most functions are gentle with their list: whatever a compiler has concluded about it stays in force up to the reads.
    const isGentle = random.chance(0.7);
    const twoLists = !isGentle && random.chance(0.4);
    const list = () => (twoLists && random.chance(0.4) ? "other" : "list");
    const written = (template: string) => template.replace(/\bN\b/g, number).replace(/\bL\b/g, list());
    const stop = form === "generator" ? "yield a;" : form === "async" ? "await null;" : "";
    const simple = (): string =>
      random.weighted([
        [5, () => written(isGentle ? random.pick(changes.slice(0, 4)) : random.pick(changes))],
        [6, () => written(random.pick(reads))],
        [4, () => random.pick(advances).replace(/\bx\b/g, "q")],
        [stop ? 2 : 0, () => stop],
        [twoLists ? 1 : 0, () => random.pick(["list = other;", "other = list;", "[list, other] = [other, list];", "list = a > b ? list : other;", "other = list.slice();", "list = list.concat(other);"])],
      ] as const)();
    const block = (size: number) => Array.from({ length: size }, simple).join("\n  ");
    const nested = (): string =>
      random.weighted([
        [6, () => `for (let x = ${random.pick(["0", "1", "60", "p"])}; x < ${random.pick(["2", "3", "61", "q + 2"])} && turns++ < 6; x++) {\n  ${[random.pick(advances), block(random.between(1, 3))].join("\n  ")}\n  }`],
        [2, () => `while (turns++ < ${random.between(1, 4)}) {\n  ${block(random.between(1, 3))}\n  }`],
        [3, () => `if (${random.pick(["a > b", "p === 3", "a % 2 === 0", "list.length > 1", "b !== b"])}) {\n  ${block(random.between(1, 2))}\n  } else {\n  ${block(random.between(1, 2))}\n  }`],
        [1, () => `switch (a & 3) {\n    case 0:\n  ${block(1)}\n      break;\n    case 1:\n  ${block(1)}\n    default:\n  ${block(1)}\n  }`],
        [1, () => `try {\n  ${block(1)}\n    if (a === a) throw a;\n  ${block(1)}\n  } catch {\n  ${block(1)}\n  } finally {\n  ${block(1)}\n  }`],
        [form === "generator" || form === "async" ? 0 : 1, () => `(() => {\n  ${block(random.between(1, 2))}\n  })();`],
        [8, () => block(random.between(1, 3))],
      ] as const)();
    const body = `let a: number = ${random.pick(["p", "p", "p + 1", "q", "0", "1"])};
  let b: number = ${random.pick(["q", "q", "0.5", "p * 2", "1"])};
  let c: number = ${random.pick(["0", "p + q", "1"])};
  let turns = 0;
  let out = "";
  ${twoLists || random.chance(0.3) ? "let" : "const"} list: number[] = ${written(isGentle ? random.pick(makers.slice(0, 8)) : random.pick(makers))};
  ${twoLists ? `let other: number[] = ${written(random.pick(makers))};\n  ` : ""}${Array.from({ length: random.between(2, 6) }, nested).join("\n  ")}
  ${written(random.pick(reads)).replace(/\bother\b/g, "list")}
  return out + show(a) + "," + show(b) + "," + show(c);`;
    const given = random.pick(["3, 60", "3, 60", "0, 1", "1, 2", "7, 0.5", "2147483640, 3", "-1, 4", "100000, 100000", "0.5, 2", "5, -0"]);
    names.push(form + (twoLists ? "-2" : "") + (isGentle ? "-gentle" : ""));
    if (form === "function") text.push(`function run${id}(p: number, q: number): string {\n  ${body}\n}`), calls.push(`console.log("${id}: " + run${id}(${given}));`);
    else if (form === "arrow") text.push(`const run${id} = (p: number, q: number): string => {\n  ${body}\n};`), calls.push(`console.log("${id}: " + run${id}(${given}));`);
    else if (form === "method") text.push(`class Home${id} {\n  run(p: number, q: number): string {\n  ${body}\n  }\n}`), calls.push(`console.log("${id}: " + new Home${id}().run(${given}));`);
    else if (form === "async") text.push(`async function run${id}(p: number, q: number): Promise<string> {\n  ${body}\n}`), calls.push(`console.log("${id}: " + (await run${id}(${given})));`);
    else
      text.push(`function* run${id}(p: number, q: number): Generator<number, string, unknown> {\n  ${body}\n}`),
        calls.push(`{\n  const steps = run${id}(${given});\n  let result = steps.next();\n  for (let i = 0; i < 60 && !result.done; i++) result = steps.next();\n  console.log("${id}: " + result.value);\n}`);
  }
  text.push(calls.join("\n"));
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}

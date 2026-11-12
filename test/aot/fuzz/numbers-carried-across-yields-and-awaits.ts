// Six number variables go through one or two counted loops in a generator, an async function or an async generator, and the function is
// suspended in the middle of the arithmetic. Whatever is alive at a `yield` or an `await` has to be put away and brought back as it was:
// a loop counter, a value read just before, a variable that began as a small integer and has left that range since. Some suspensions
// happen on one path only, some inside try blocks whose finally clause runs when the caller stops early. A generator is stepped by hand
// with numbers sent in, walked by for-of with a break, spread, taken apart by a pattern, or stepped in turn with a second one of its kind.
// Async functions run several at a time. A module variable that each function folds its numbers into shows the order in which they ran.
// Some functions take up to eleven more parameters, more than registers can hold, which are given numbers, objects, lists and texts, and
// read them, store to them or set them to null between suspensions: by then the frame of the caller that passed them is gone.
// One or two of the six can be counters and nothing else: a written start just below the edge of 32-bit integers or of exact whole numbers,
// one written step, no other store, and often a closure that captures them. A compiler works out a range for such a variable, and what
// it puts away at a suspension depends on that range. Some functions leave their six numbers in a module variable through a list that a
// callback goes through, which shows a wrong range that a sum hides.
// Half of the programs have generators alone and wait for nothing.
import type { Random } from "./random";

const locals = ["a", "b", "c", "d", "e", "f"];
const small = [-1, 0, 1, 2, 3, 5, 7, 9];
const few = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 100, -1, -2, -7];
const edges = [
  255, 256, 32767, 32768, -32768, 65535, 65536, -65536, 2147483647, 2147483646, -2147483648, -2147483647, 1073741824, -1073741824,
  4294967295, 4294967296, 0.5, -0.5,
];

const belowAnEdge = [
  2147483600, 2147483639, 2147483647, 2147483600, 2147483639, 9007199254740983, 9007199254740991, 9007199254740983, 9007199254740991,
  -2147483640, -2147483648, 4294967287, 65530, 32760, 250,
];

export function generate(random: Random, typed: boolean): string {
  const number = typed ? ": number" : "";
  const as = (type: string) => (typed ? `: ${type}` : "");
  const waits = random.chance(0.5);
  const functions: string[] = [];
  const total = random.between(3, 6);

  for (let index = 0; index < total; index++) {
    const kind = waits ? random.pick(["generator", "async", "async", "async generator"] as const) : "generator";
    const yields = kind !== "async";
    const awaits = kind !== "generator";
    /** How a generator is used. Only a caller that steps it by hand sends numbers in. */
    const use = random.pick(kind === "generator" ? (["steps", "steps", "two in turn", "for-of", "spread", "pattern"] as const) : (["steps", "for-of"] as const));
    const isSentNumbers = yields && (use === "steps" || use === "two in turn");
    const name = `k${index}`;
    // The counters. The other statements only read them.
    const steady = random.sample(["d", "e", "f"], random.pick([0, 0, 1, 2, 2]));
    const free = locals.filter(each => !steady.includes(each));
    const variable = () => random.pick(free);
    const other = (not: string) => random.pick(free.filter(each => each !== not));
    const ticks = steady.map((v, n) => {
      const way = random.pick([`${v} += 1`, `${v} += 1`, `${v}++`, `++${v}`, `${v} = 1 + ${v}`, `${v} = ${v} + 1`, `${v} += 3`, `${v} += 7`, `${v} -= 1`, `${v}--`, `${v} += 2`]);
      const isCaptured = random.chance(0.6);
      return {
        text: isCaptured ? [`const tick${n} = ()${as("void")} => { ${way}; };`] : [],
        statement: isCaptured && random.chance(0.7) ? `tick${n}();` : `${way};`,
      };
    });
    const spares = Array.from({ length: random.pick([0, 0, 3, 6, 9, 11]) }, (_, n) => `p${n}`);
    const given = spares
      .map(() => random.pick(small))
      .map(n => `, ${random.pick([`${n}`, `${n}`, `{ id: ${n} }`, `{ id: ${n} }`, `[${n}]`, `"t${n}"`])}`)
      .join("");
    const operand = (counters: string[]) =>
      random.chance(0.15)
        ? String(random.pick(small))
        : random.chance(0.25) && counters.length
          ? random.pick(counters)
          : random.chance(0.15) && steady.length
            ? random.pick(steady)
            : variable();
    const sum = (u: string, v: string) =>
      random.pick([
        `(${u} + ${v}) | 0`,
        `(${u} - ${v}) | 0`,
        `${u} + ${v}`,
        `${u} - ${v}`,
        `${u} ^ ${v}`,
        `${u} & ${v}`,
        `Math.imul(${u}, ${v})`,
        `(${u} >>> 1) + ${v}`,
      ]);

    const plain = (counters: string[]): string => {
      const v = variable();
      const w = other(v);
      return random.pick([
        `${v} = ${sum(operand(counters), operand(counters))};`,
        `${v} = ${sum(v, operand(counters))};`,
        `${v} = ${operand(counters)} > ${operand(counters)} ? ${w} : ${other(w)};`,
        `{ const t = ${v}; ${v} = ${w}; ${w} = t; }`,
        `if (${v} > ${w}) ${v} = ${sum(v, w)}; else ${w} = ${sum(w, operand(counters))};`,
        `${v} = ${random.pick([`${v} + 0.5`, `${v} / 2`, `-${v}`, `${v} + 2147483647`, `${v} * 65536`, `${v} % 7`])};`,
        "said = [a, b, c, d, e, f].map(show).join();",
        ...(spares.length
          ? [
              `${v} = ${sum(v, `fold(${random.pick(spares)})`)};`,
              `${v} = ${sum(v, `fold(${random.pick(spares)})`)};`,
              `${random.pick(spares)} = null;`,
              `${random.pick(spares)} = null;`,
              `${random.pick(spares)} = null;`,
              `${random.pick(spares)} = undefined;`,
              `${random.pick(spares)} = ${v};`,
            ]
          : []),
      ]);
    };

    /** A statement that suspends the function, with values alive on both sides of it. */
    const suspension = (counters: string[]): string => {
      const v = variable();
      const w = other(v);
      const forms: string[] = [];
      if (yields) {
        forms.push(
          `yield ${operand(counters)};`,
          `yield ${sum(v, operand(counters))};`,
          `if (${v} & ${random.pick([1, 2, 4])}) yield ${w};`,
          `{ const before = ${v}; yield ${w}; ${v} = ${sum(v, "before")}; }`,
          `${v} = ${sum(v, `(yield* count(${operand(counters)}, ${random.pick(["2", "3", `(${w} & 3)`])}))`)};`,
          `try { yield ${v}; ${w} = ${sum(w, operand(counters))}; yield ${w}; } finally { order = (Math.imul(order, 31) + ${v}) | 0; }`,
        );
        if (isSentNumbers)
          forms.push(
            `${v} = ${sum(v, `(yield ${operand(counters)})`)};`,
            `${v} = ${sum(`(yield ${w})`, v)};`,
            `{ const before = ${v}; const got${number} = yield ${w}; ${v} = ${sum("before", "got")}; }`,
            `if ((yield ${v}) > ${operand(counters)}) ${w} = ${sum(w, v)};`,
          );
      }
      if (awaits)
        forms.push(
          "await null;",
          `${v} = ${sum(v, `(await ${operand(counters)})`)};`,
          `${v} = ${sum(`(await soon(${w}))`, v)};`,
          `${v} = await ${random.pick([`soon(${w})`, `Promise.resolve(${w})`, `afterAJob(${w})`, `answers(${w})`])};`,
          `{ const before = ${v}; await null; ${v} = ${sum(v, "before")}; }`,
          `if (${v} & ${random.pick([1, 2, 4])}) await null;`,
          `try { await null; if (${v} & 2) throw 0; ${w} = ${sum(w, `(await soon(${v}))`)}; } catch { ${v} = ${sum(v, "1")}; } finally { order = (Math.imul(order, 31) + ${w}) | 0; }`,
          `{ const [p, q] = await Promise.all([soon(${v}), soon(${operand(counters)})]); ${w} = ${sum("p", "q")}; }`,
          `for await (const each of [${v}, soon(${w})]) ${other(v)} = ${sum(v, "each")};`,
          `order = (Math.imul(order, 31) + ${v}) | 0;`,
        );
      return random.pick(forms);
    };

    const statements = (counters: string[], length: number) =>
      Array.from({ length }, () => (random.chance(0.5) ? suspension : plain)(counters));
    const turns = () => random.pick(["2", "3", "4", "5", "(x & 3) + 1", "(y & 3)"]);
    const manyTurns = () => random.pick(["17", "24", "33", "(x & 31) + 8", "(z & 15) + 17"]);
    const nested = random.chance(0.45);
    const inside = nested ? ticks.filter(() => random.chance(0.5)) : [];
    const inner = nested
      ? [
          `for (let i1 = 0; i1 < ${turns()}; i1++) {`,
          ...random.shuffled([suspension(["i0", "i1"]), ...inside.map(tick => tick.statement), ...statements(["i0", "i1"], random.between(1, 3))]).map(line => "  " + line),
          "}",
        ]
      : [];
    const body = random
      .shuffled([
        suspension(["i0"]),
        ...ticks.filter(tick => !inside.includes(tick)).map(tick => tick.statement),
        ...statements(["i0"], random.between(2, 4)),
        inner.join("\n    "),
      ])
      .filter(line => line !== "");
    const returns = {
      generator: `Generator<number, number, ${isSentNumbers ? "number" : "unknown"}>`,
      async: "Promise<number>",
      "async generator": `AsyncGenerator<number, number, ${isSentNumbers ? "number" : "unknown"}>`,
    }[kind];
    const lines = [
      `let a${number} = x, b${number} = y, c${number} = z, ${["d", "e", "f"].map(each => `${each}${number} = ${random.pick(steady.includes(each) ? belowAnEdge : small)}`).join(", ")};`,
      ...ticks.flatMap(tick => tick.text),
      ...statements([], random.between(0, 1)),
      `for (let i0 = 0; i0 < ${steady.length && random.chance(0.7) ? manyTurns() : turns()}; i0++) {`,
      ...body.map(line => "  " + line),
      "}",
      ...statements([], random.between(0, 2)),
      ...(random.chance(0.6) ? ["said = [a, b, c, d, e, f].map(show).join();"] : []),
      "return a + 3 * b + 5 * c + 7 * d + 11 * e + 13 * f;",
    ];
    const head = { generator: "function*", async: "async function", "async generator": "async function*" }[kind];
    const wait = awaits ? "await " : "";
    const most = random.pick([3, 7, 20, 60, 400, 400]);

    /** A function that uses up one generator, or two, and hands back a text. */
    const user = {
      steps: `const it = ${name}(x, y, z${given});
  let total = 0, sent = 1;
  for (let step = 0; step < ${most}; step++) {
    const r = ${wait}it.next(sent);
    if (r.done) return total + "=" + r.value;
    total = (total + r.value) | 0;
    sent = (r.value & 15) - 3;
  }
  ${wait}it.return(0);
  return total + "~";`,
      "two in turn": `const first = ${name}(x, y, z${given}), second = ${name}(z, x, y${given});
  let total = 0, sent = 1;
  for (let step = 0; step < ${most}; step++) {
    const r = first.next(sent), s = second.next(total & 7);
    if (r.done || s.done) return total + "=" + r.value + "," + s.value;
    total = (total + r.value - s.value) | 0;
    sent = (s.value & 15) - 3;
  }
  second.return(0);
  first.return(0);
  return total + "~";`,
      "for-of": `let total = 0, steps = 0;
  for ${wait}(const each of ${name}(x, y, z${given})) {
    total = (total + each) | 0;
    if (++steps === ${most}) break;
  }
  return total + "#" + steps;`,
      spread: `const all = [...${name}(x, y, z${given})];
  return all.reduce((sum, each) => (sum + each) | 0, 0) + "#" + all.length;`,
      pattern: `const [p, q = -1, ...rest] = ${name}(x, y, z${given});
  const [r] = ${name}(z, y, x${given});
  return p + "," + q + "," + r + "#" + rest.length;`,
    }[use];

    const whole = () => random.pick(random.chance(0.55) ? few : edges);
    const triples = Array.from({ length: random.between(4, 7) }, () => `(${whole()}, ${whole()}, ${whole()}${yields ? "" : given})`);
    const called = yields ? `use${index}` : name;
    const results = !awaits
      ? `[${triples.map(triple => called + triple).join(", ")}]`
      : random.chance(0.6)
        ? `await Promise.all([${triples.map(triple => called + triple).join(", ")}])`
        : `[${triples.map(triple => `await ${called}${triple}`).join(", ")}]`;
    functions.push(`${head} ${name}(x${number}, y${number}, z${number}${spares.map(each => `, ${each}${as("any")}`).join("")})${as(returns)} {
  ${lines.join("\n  ")}
}
${
  yields
    ? `${awaits ? "async " : ""}function use${index}(x${number}, y${number}, z${number})${as(awaits ? "Promise<string>" : "string")} {
  ${user}
}
`
    : ""
}console.log("${name}", (${results}).join(" "), order, said);`);
  }

  return `let order = 0;
let said = "";
const show = (v${as("unknown")})${as("string")} => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v));
function fold(value${as("unknown")})${number} {
  return typeof value === "number" ? value | 0 : value === null ? 3 : value === undefined ? 5 : 7;
}
function* count(from${number}, steps${number})${as("Generator<number, number, unknown>")} {
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    yield from + i;
    sum = (sum + from + i) | 0;
  }
  return sum;
}
${
  waits
    ? `async function soon(v${number})${as("Promise<number>")} { return v; }
function afterAJob(v${number})${as("Promise<number>")} { return new Promise(resolve => queueMicrotask(() => resolve(v))); }
function answers(v${number})${as("PromiseLike<number>")} { return { then(resolve${as("any")}) { return resolve(v); } }; }
`
    : ""
}${functions.join("\n")}
${typed ? "export {};\n" : ""}`;
}

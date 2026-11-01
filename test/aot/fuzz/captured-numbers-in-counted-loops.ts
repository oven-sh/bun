// Six number variables go through one or two counted loops, and closures do part of the arithmetic on them. A compiler wants such a
// variable in a register, and may keep it there only while it knows every closure that can read or write it and when each one runs.
// Each function here mixes both: plain sums, choices and swaps stand beside calls of closures that add to, swap or read the same
// variables. A closure is called by name, out of a list, through a helper, by a built-in, from a module variable or after the function
// has returned. Some are created on one path only, some in each turn of a loop over that turn's counter, and some call themselves in
// tail position. The arguments are written out at each call and include the edges of 32-bit integers, so a variable that starts as a
// small integer can leave that range inside a closure. Some variables start at a written number just below such an edge and go up or
// down by a written step, in the function or in a closure, in a loop with enough turns to cross it: a compiler that works out the range
// of a counter from its start, its step and the turns has to count the steps that closures take. Nothing is printed inside a function.
// One or two of the six can be counters and nothing else: no other statement stores to them, because a compiler works out a range only
// for a variable whose every store it can see through. How a function hands its six numbers back is drawn too: a wrong range can show in a list that a callback goes through and stay hidden
// in the same list joined, in a template or in a sum.
import type { Random } from "./random";

const locals = ["a", "b", "c", "d", "e", "f"];
const small = [-1, 0, 1, 2, 3, 5, 7, 9];
const few = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 100, -1, -2, -7];
const edges = [
  255, 256, 32767, 32768, -32768, 65535, 65536, -65536, 2147483647, 2147483646, -2147483648, -2147483647, 1073741824, -1073741824,
  4294967295, 4294967296, 0.5, -0.5,
];

// The edges of 32-bit integers and of exact whole numbers come up most often.
const belowAnEdge = [
  2147483600, 2147483639, 2147483647, 2147483600, 2147483639, 9007199254740983, 9007199254740991, 9007199254740983, 9007199254740991,
  -2147483640, -2147483648, 4294967287, 65530, 32760, 250,
];

type Closure = { name: string; text: string; takes: number; returns: boolean };

export function generate(random: Random, typed: boolean): string {
  const number = typed ? ": number" : "";
  const as = (type: string) => (typed ? `: ${type}` : "");
  const functions: string[] = [];
  const total = random.between(3, 6);

  for (let index = 0; index < total; index++) {
    const name = `k${index}`;
    // The counters: a written start, one written step, no other store. The other statements only read them.
    const steady = random.sample(["d", "e", "f"], random.pick([0, 1, 2, 2, 2]));
    const free = locals.filter(each => !steady.includes(each));
    const captured = random.sample(free, random.between(2, free.length));
    const variable = () => random.pick(free);
    const caught = () => random.pick(captured);
    const other = (not: string) => random.pick(free.filter(each => each !== not));
    const operand = (counters: string[]) =>
      random.chance(0.15)
        ? String(random.pick(small))
        : random.chance(0.2) && counters.length
          ? random.pick(counters)
          : random.chance(0.15) && steady.length
            ? random.pick(steady)
            : variable();

    /** An expression over two operands; about half of them stay within 32 bits. */
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
        `${u} > ${v} ? ${u} : ${v}`,
      ]);

    /** The variable goes up or down by a written number. */
    const step = (v: string) => random.pick([`${v} += 1`, `${v} += 1`, `${v}++`, `++${v}`, `${v} = 1 + ${v}`, `${v} = ${v} + 1`, `${v} += 3`, `${v} += 7`, `${v} -= 1`, `${v}--`, `${v} += 2`]);

    const closures: Closure[] = [];
    const writers: Closure[] = [];
    const add = (closure: Closure) => (closures.push(closure), closure);
    const count = random.between(2, 4);
    for (let n = 0; n < count; n++) {
      const v = caught();
      const w = other(v);
      // The first closure always writes, so no function has readers alone.
      const kind = n === 0 ? random.pick([0, 1, 7]) : random.weighted([[3, 0], [2, 1], [1, 2], [1, 3], [1, 4], [1, 5], [2, 6], [3, 7]]);
      if (kind === 0)
        writers.push(add({ name: `w${n}`, takes: 1, returns: false, text: `const w${n} = (v${number})${as("void")} => { ${v} = ${sum(v, "v")}; };` }));
      else if (kind === 1)
        add({ name: `w${n}`, takes: 0, returns: true, text: `const w${n} = ()${number} => { ${v} = ${sum(v, w)}; return ${random.pick([v, w])}; };` });
      else if (kind === 2) add({ name: `r${n}`, takes: 0, returns: true, text: `const r${n} = ()${number} => ${sum(v, w)};` });
      else if (kind === 3)
        add({ name: `s${n}`, takes: 0, returns: false, text: `const s${n} = ()${as("void")} => { const t = ${v}; ${v} = ${w}; ${w} = t; };` });
      else if (kind === 4)
        add({
          name: `g${n}`,
          takes: 0,
          returns: true,
          text: `const m${n} = (step${number}) => ()${number} => (${v} = ${sum(v, "step")});\n  const g${n} = m${n}(${random.pick(small)});`,
        });
      else if (kind === 7) add({ name: `bump${n}`, takes: 0, returns: false, text: `const bump${n} = ()${as("void")} => { ${step(v)}; };` });
      else if (kind === 5)
        add({
          name: `h${n}`,
          takes: 0,
          returns: false,
          text: `const h${n} = ()${as("void")} => { ${v} = ${random.pick([`${v} + 0.5`, `${v} / 2`, `-${v}`, `${v} + 2147483647`, `${v} * 65536`, `${v} % 7`])}; };`,
        });
      else {
        // It calls itself in tail position, with as many or with more arguments than it was given.
        const wide = random.chance(0.5);
        add({
          name: `down${n}`,
          takes: 1,
          returns: true,
          text: wide
            ? `function down${n}(n${number}, sum${number} = 0, last${number} = 0)${number} { if (n <= 0) return sum + last + ${w}; ${v} = ${sum(v, "n")}; return down${n}(n - 1, (sum + ${v}) | 0, n); }`
            : `const down${n} = (n${number})${number} => (n <= 0 ? ${v} : ((${v} = ${sum(v, "n")}), down${n}(n - 1)));`,
        });
      }
    }
    // A closure captures most counters. It steps the counter, or the loop does and the closure is only there.
    const ticks = steady.map((v, n) => {
      const way = step(v);
      const isCaptured = random.chance(0.75);
      return {
        text: isCaptured ? [`const tick${n} = ()${as("void")} => { ${way}; };`] : [],
        statement: isCaptured && random.chance(0.7) ? `tick${n}();` : `${way};`,
      };
    });
    const list = writers.length >= 2 && random.chance(0.7);
    const optional = random.chance(0.35);
    const later = random.chance(0.4);
    const escapes = writers.length > 0 && random.chance(0.3);
    const handsBack = random.chance(0.25);
    const bounded = (counters: string[]) => random.pick([`(${variable()} & 7)`, `(${variable()} & 3) + 1`, ...counters.map(each => `${each} + 2`), "4"]);

    /** A call of one of the closures, as a statement. */
    const callOf = (closure: Closure, counters: string[]): string => {
      const argument = closure.name.startsWith("down") ? bounded(counters) : operand(counters);
      const direct = `${closure.name}(${closure.takes ? argument : ""})`;
      if (closure.returns) {
        const into = variable();
        return random.pick([
          `${into} = ${sum(into, direct)};`,
          `${into} = ${direct};`,
          `{ const before = ${into}; const got = ${direct}; ${into} = ${sum("before", "got")}; }`,
          `if (${direct} > ${operand(counters)}) ${into} = ${sum(into, other(into))};`,
          ...(closure.takes ? [] : [`${into} = ${sum(into, `run(${closure.name})`)};`]),
        ]);
      }
      const seen = caught();
      return random.pick([
        `${direct};`,
        `${direct};`,
        `{ const before = ${seen}; ${direct}; ${seen} = ${sum(seen, "before")}; }`,
        ...(closure.takes
          ? [
              `apply(${closure.name}, ${argument});`,
              `[${operand(counters)}, ${operand(counters)}].forEach(${typed ? `each => ${closure.name}(each)` : closure.name});`,
              `try { ${direct}; if (${variable()} & 1) throw 0; ${closure.name}(${operand(counters)}); } catch { ${seen} = ${sum(seen, "1")}; } finally { ${variable()} ^= ${seen}; }`,
            ]
          : [`run(${closure.name});`, `if (${variable()} & ${random.pick([1, 2, 4])}) ${direct};`]),
      ]);
    };

    const call = (counters: string[]) => callOf(random.pick(closures), counters);

    const plain = (counters: string[]): string => {
      const v = variable();
      const w = other(v);
      return random.pick([
        `${v} = ${sum(operand(counters), operand(counters))};`,
        `${v} = ${sum(v, operand(counters))};`,
        `${v} = ${operand(counters)} > ${operand(counters)} ? ${w} : ${other(w)};`,
        `{ const t = ${v}; ${v} = ${w}; ${w} = t; }`,
        `if (${v} > ${w}) ${v} = ${sum(v, w)}; else ${w} = ${sum(w, operand(counters))};`,
        `${step(v)};`,
        `${step(v)};`,
        `${step(v)};`,
      ]);
    };

    /** One statement for each thing that the function declares beside its closures. */
    const declared = (counters: string[]): string[] => {
      const counter = counters[counters.length - 1];
      return [
        ...(list ? [`ways[${random.pick([`${counter} & 1`, `${variable()} & 1`])}](${operand(counters)});`] : []),
        ...(optional ? [random.pick(["if (maybe) maybe();", "maybe?.();"])] : []),
        ...(later
          ? [
              random.chance(0.5)
                ? `later.push(() => ${sum(counter, caught())});`
                : `{ let own${number} = ${sum(counter, variable())}; later.push(() => (own = ${sum("own", caught())})); }`,
            ]
          : []),
        ...(escapes ? [`poke(${operand(counters)});`] : []),
      ];
    };

    const special = (counters: string[]): string[] => {
      const choices = declared(counters);
      const counter = counters[counters.length - 1];
      choices.push(`{ const skip = ()${as("void")} => { ${counter}++; }; if ((${variable()} & 3) === 0) skip(); }`);
      choices.push(`${variable()} = [${operand(counters)}, ${operand(counters)}, ${operand(counters)}].reduce((sum, each) => (sum + each + ${caught()}) | 0, 0);`);
      return choices;
    };

    /** What needs a counter is drawn inside a loop only. */
    const statements = (counters: string[], length: number) =>
      Array.from({ length }, () =>
        random.weighted([[4, call], [3, plain], [counters.length ? 2 : 0, (given: string[]) => random.pick(special(given))]] as const)(counters),
      );

    const turns = () => random.pick(["2", "3", "4", "5", "7", "9", "(x & 7)", "(y & 3) + 1"]);
    const manyTurns = () => random.pick(["17", "24", "33", "70", "(x & 63)", "(y & 31) + 8", "(z & 15) + 17"]);
    // Every closure is called and every thing declared is used at least once, in one loop or the other.
    const nested = random.chance(0.45);
    const owed = [
      ...closures.map(closure => (counters: string[]) => callOf(closure, counters)),
      ...declared(["i0"]).map((_, at) => (counters: string[]) => declared(counters)[at]),
      ...ticks.map(tick => () => tick.statement),
    ];
    const inside = nested ? owed.filter(() => random.chance(0.5)) : [];
    const inner = nested
      ? [
          `for (let i1 = 0; i1 < ${turns()}; i1++) {`,
          ...random.shuffled([...inside.map(make => make(["i0", "i1"])), ...statements(["i0", "i1"], random.between(1, 2))]).map(line => "  " + line),
          "}",
        ]
      : [];
    const body = random
      .shuffled([...owed.filter(make => !inside.includes(make)).map(make => make(["i0"])), ...statements(["i0"], random.between(1, 3)), inner.join("\n    ")])
      .filter(line => line !== "");
    const start = () => random.pick(random.chance(0.5) ? belowAnEdge : small);
    const all = random.weighted([
      [5, "[a, b, c, d, e, f].map(show).join()"],
      [2, "[a, b, c, d, e, f].join()"],
      [2, locals.map(each => `show(${each})`).join(' + "," + ')],
      [1, locals.map(each => `String(${each})`).join(' + "," + ')],
      [1, "`" + locals.map(each => "${" + each + "}").join() + "`"],
      [1, locals.join(' + "," + ')],
      [1, "[a / 2, b / 2, c / 2, d / 2, e / 2, f / 2].map(show).join()"],
      [1, "a + 3 * b + 5 * c + 7 * d + 11 * e + 13 * f"],
    ]);
    const peek = caught();

    const lines = [
      ...(random.chance(0.5) ? ['"use strict";'] : []),
      `let a${number} = x, b${number} = y, c${number} = z, ${["d", "e", "f"].map(each => `${each}${number} = ${steady.includes(each) ? random.pick(belowAnEdge) : start()}`).join(", ")};`,
      ...closures.map(closure => closure.text),
      ...ticks.flatMap(tick => tick.text),
      ...(list ? [`const ways = [${writers[0].name}, ${writers[1].name}];`] : []),
      ...(optional
        ? [`let maybe${as("(() => void) | null")} = null;`, `if (${random.pick(["x > y", "z & 1", "y", "x === z"])}) maybe = () => { ${peek} = ${sum(peek, other(peek))}; };`]
        : []),
      ...(later ? [`const later${as("(() => number)[]")} = [];`] : []),
      ...(escapes ? [`escaped = ${writers[0].name};`] : []),
      `for (let i0 = 0; i0 < ${(steady.length ? random.chance(0.3) : nested || random.chance(0.4)) ? turns() : manyTurns()}; i0++) {`,
      ...body.map(line => "  " + line),
      "}",
      ...(later ? [`for (const each of later) ${variable()} = ${sum(variable(), "each()")};`, ...(random.chance(0.5) ? [`for (const each of later) ${variable()} ^= each();`] : [])] : []),
      ...statements([], random.between(0, 2)),
      handsBack
        ? `return { sum: ${all}, poke: (v${number})${as("void")} => { ${peek} = ${sum(peek, "v")}; }, peek: ()${number} => ${sum(peek, other(peek))} };`
        : `return ${all};`,
    ];

    const whole = () => random.pick(random.chance(0.55) ? few : edges);
    const calls = Array.from({ length: random.between(5, 8) }, () => `${name}(${whole()}, ${whole()}, ${whole()})`);
    const shown = handsBack
      ? calls.map(each => `(held => (held.poke(${whole()}), held.sum + "/" + held.peek()))(${each})`)
      : calls.map(each => (escapes && random.chance(0.3) ? `${each} + "/" + (poke(${whole()}), 0)` : each));
    functions.push(`function ${name}(x${number}, y${number}, z${number}) {
  ${lines.join("\n  ")}
}
console.log("${name}", [${shown.join(", ")}].join(" "));`);
  }

  return `const show = (v${as("unknown")})${as("string")} => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v));
let escaped${as("(v: number) => void")} = () => {};
function poke(v${number})${as("void")} { escaped(v); }
function apply(f${as("(v: number) => void")}, v${number})${as("void")} { f(v); }
function run${typed ? "<T>" : ""}(f${as("() => T")})${as("T")} { return f(); }
${functions.join("\n")}
${typed ? "export {};\n" : ""}`;
}

// Functions made of nested and crossed loops: labelled breaks and continues out of inner loops, switches that fall through, try | catch | finally round and
// inside loops, `yield*`, for-of and for-await, and statements behind a return, a throw, a break, a continue or a `finally` that returns, which nothing enters.
// Every loop takes from `fuel`, so every function ends.

type Kind = "plain" | "generator" | "async" | "async generator";
const kinds: Kind[] = ["plain", "generator", "async", "async generator"];

function random(seed: number) {
  let state = (seed * 2654435761 + 1) >>> 0;
  return (below: number) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) % below;
  };
}

type Around = { kind: Kind; depth: number; loops: string[]; blocks: string[]; isInLoop: boolean; isInSwitch: boolean };

function statements(next: (below: number) => number, around: Around, count: number): string {
  let text = "";
  for (let index = 0; index < count; index++) text += statement(next, around) + "\n";
  return text;
}

function statement(next: (below: number) => number, around: Around): string {
  const { kind, depth, loops, blocks } = around;
  const number = next(9) + 1;
  const isGenerator = kind.endsWith("generator");
  const isAsync = kind.startsWith("async");
  const body = (more: Partial<Around> = {}) => statements(next, { ...around, depth: depth + 1, ...more }, next(3) + 1);
  const choice = next(depth > 3 ? 12 : 30);
  switch (choice) {
    case 0:
    case 1:
      return `s += ${number};`;
    case 2:
      return `x = (x * 3 + ${number}) & 1023;`;
    case 3:
      return `s += v${next(3)} + x;`;
    case 4:
      return isGenerator ? `s += (yield s) | 0;` : `s ^= ${number};`;
    case 5:
      return isGenerator ? `s += yield* ${isAsync ? "innerAsync" : "inner"}();` : `s -= ${number};`;
    case 6:
      return isAsync ? `await null;` : `x += ${number};`;
    case 7:
      return `return s + ${number};`;
    case 8:
      return `throw new Error("thrown " + s);`;
    case 9:
      return around.isInLoop || around.isInSwitch ? `break;` : `s += 1;`;
    case 10:
      return around.isInLoop ? `continue;` : `s += 2;`;
    case 11: {
      const labels = [
        ...loops.map(label => `continue ${label};`),
        ...[...loops, ...blocks].map(label => `break ${label};`),
      ];
      return labels.length ? labels[next(labels.length)] : `s += 3;`;
    }
    case 12:
    case 13:
      return `if ((s + x) % ${number + 1}) {\n${body()}} else {\n${body()}}`;
    case 14:
      return `try {\n${body()}} finally {\n${body()}}`;
    case 15:
      return `try {\n${body()}} catch (error) {\ns += error.message.length;\n${body()}}`;
    case 16:
      return `try {\n${next(2) ? body() : ""}} finally {\nreturn s + ${number};\n}`;
    case 17:
      return `try {\n${body()}} catch (error) {\nthrow error;\n} finally {\n${body()}}`;
    case 18: {
      const label = `B${depth}_${next(1000)}`;
      return `${label}: {\n${body({ blocks: [...blocks, label] })}}`;
    }
    case 19:
      return `switch ((s + x) % 3) {\ncase 0:\n${body({ isInSwitch: true })}case 1:\n${body({ isInSwitch: true })}break;\ndefault:\n${body({ isInSwitch: true })}}`;
    default: {
      const label = `L${depth}_${next(1000)}`;
      const inside = body({ loops: [...loops, label], isInLoop: true, isInSwitch: false });
      const name = `i${depth}_${next(1000)}`;
      const forms = [
        `for (let ${name} = 0; ${name} < ${number} && fuel-- > 0; ${name}++) {\n${inside}}`,
        `while (fuel-- > 0) {\n${inside}}`,
        `do {\n${inside}} while (fuel-- > 0 && (s + x) % ${number + 1});`,
        `for (const ${name} of [1, 2, 3]) {\nif (fuel-- <= 0) break;\ns += ${name};\n${inside}}`,
        `for (const ${name} in { a: 1, b: 2 }) {\nif (fuel-- <= 0) break;\n${inside}}`,
        `for (;;) {\nif (fuel-- <= 0) break;\n${inside}}`,
        isAsync
          ? `for await (const ${name} of innerAsync()) {\nif (fuel-- <= 0) break;\n${inside}}`
          : `for (const ${name} of inner()) {\nif (fuel-- <= 0) break;\n${inside}}`,
      ];
      return `${label}: ${forms[next(forms.length)]}`;
    }
  }
}

/** An ES module of `count` functions, which prints a line for each: what it returned or yielded, or what it threw. */
export function crossedLoops(seed: number, count: number): string {
  const next = random(seed);
  let text = `let fuel = 0;
const out = [];
function* inner() { yield 1; return 2; }
async function* innerAsync() { yield 1; return 2; }
async function drive(name, make) {
  fuel = 60;
  try {
    let made = make();
    if (made && typeof made.next === "function") {
      const seen = [];
      for (let turn = 0; turn < 12; turn++) {
        const step = await made.next(turn);
        seen.push(step.value);
        if (step.done) break;
      }
      made = seen.join();
    }
    out.push(name + " " + (await made));
  } catch (error) {
    out.push(name + " threw " + error.message);
  }
}
`;
  for (let index = 0; index < count; index++) {
    const kind = kinds[next(kinds.length)];
    const head = {
      plain: "function",
      generator: "function*",
      async: "async function",
      "async generator": "async function*",
    }[kind];
    const around: Around = { kind, depth: 0, loops: [], blocks: [], isInLoop: false, isInSwitch: false };
    text += `${head} f${index}() {\nlet s = 0, x = ${next(50)};\nconst v0 = x + 1, v1 = x + 2, v2 = x + 3;\n${statements(next, around, next(5) + 2)}return s + x + v0 + v1 + v2;\n}\nawait drive("f${index}", f${index});\n`;
  }
  return text + `console.log(out.join("\\n"));\n`;
}

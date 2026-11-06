// Functions that are called very often hold a loop with a constant start, step and bound that takes zero to nine turns. The step may be negative
// or larger than one and the test any comparison. The body breaks, continues, returns, throws, catches, writes the counter, makes closures over
// the counter and leaves values that are used behind the loop. The loop walks nothing, a list literal, a rest parameter, `arguments`, a text, or
// the strings of a tagged template, which are also compared, stored to, asked whether they are frozen and handed on.
import type { Random } from "./random";

type Subject = { parameters: string; before: string; element: string; length: string; call: string };

const subjects: readonly Subject[] = [
  { parameters: "seed", before: "", element: "k", length: "4", call: "(turn)" },
  {
    parameters: "seed",
    before: "const list = [seed, 2, 3.5, seed + 1, 5];",
    element: "list[k]",
    length: "list.length",
    call: "(turn)",
  },
  {
    parameters: "seed",
    before: `const list = [seed, "two", undefined, , 5];`,
    element: "list[k]",
    length: "list.length",
    call: "(turn)",
  },
  { parameters: "seed, ...rest", before: "", element: "rest[k]", length: "rest.length", call: "(turn, 1, 2, turn, 4)" },
  { parameters: "seed, ...rest", before: "", element: "rest[k]", length: "rest.length", call: "(turn)" },
  { parameters: "seed", before: "", element: "arguments[k]", length: "arguments.length", call: "(turn, 7, 8, 9)" },
  { parameters: "seed, second", before: "", element: "arguments[k]", length: "arguments.length", call: "(turn, 7, 8)" },
  { parameters: "seed", before: `const text = "abcdef";`, element: "text[k]", length: "text.length", call: "(turn)" },
  {
    parameters: "seed",
    before: `const text = "abcdef";`,
    element: "text.charCodeAt(k)",
    length: "text.length",
    call: "(turn)",
  },
  {
    parameters: "seed",
    before: "const bytes = new Uint8Array([seed, 2, 3, 4]);",
    element: "bytes[k]",
    length: "bytes.length",
    call: "(turn)",
  },
  {
    parameters: "strings, ...values",
    before: "const seed = values[0];",
    element: "strings[k]",
    length: "strings.length",
    call: "`a${turn}b${1}c${2}d`",
  },
  {
    parameters: "strings, ...values",
    before: "const seed = values[0];",
    element: "strings.raw[k]",
    length: "strings.raw.length",
    call: "`\\n${turn}\\t${1}x`",
  },
  {
    parameters: "strings, ...values",
    before: "const seed = values[0];",
    element: "values[k]",
    length: "values.length",
    call: "`a${turn}b${1}c${2}d`",
  },
  { parameters: "strings", before: "const seed = 1;", element: "strings[k]", length: "strings.length", call: "`only`" },
];

const aboutStrings = [
  `total = mix(total, strings === previous);\nprevious = strings;`,
  `total = mix(total, Object.isFrozen(strings) && Object.isFrozen(strings.raw));`,
  `try {\nstrings[0] = "stored";\n} catch (error) {\ntotal = mix(total, error.constructor.name);\n}`,
  `try {\nstrings.length = 0;\n} catch (error) {\ntotal = mix(total, error.constructor.name);\n}`,
  `keep(strings);`,
  `total = mix(total, Array.isArray(strings) + " " + strings.length + " " + strings.raw.length);`,
  `total = mix(total, strings.join("|"));`,
] as const;

function statement(random: Random, subject: Subject, at: number, depth: number): string {
  return random.weighted<() => string>([
    [6, () => `total = mix(total, ${subject.element});`],
    [3, () => `total = mix(total, k);`],
    [2, () => `if (k === ${at}) break;`],
    [2, () => `if (k === ${at}) continue;`],
    [2, () => `if (k === ${at}) return mix(total, "returned");`],
    [2, () => `if (k === ${at}) throw new Failure(total);`],
    [1, () => `if (seed % 7 === ${random.below(7)} && k === ${at}) break;`],
    [1, () => `if (seed % 5 === ${random.below(5)}) continue;`],
    [
      2,
      () =>
        `try {\nif (k === ${at}) throw k;\ntotal = mix(total, "tried");\n} catch (caught) {\ntotal = mix(total, caught);\n} finally {\ntotal = mix(total, "finally");\n}`,
    ],
    [1, () => `try {\nif (k === ${at}) break;\n} finally {\ntotal = mix(total, "left");\n}`],
    [1, () => `try {\nif (k === ${at}) continue;\n} finally {\ntotal = mix(total, "went on");\n}`],
    [
      1,
      () =>
        `try {\nif (k === ${at}) return mix(total, "out of try");\n} finally {\ntotal = mix(total, "behind the return");\n}`,
    ],
    [2, () => `if (k === ${at}) k += ${random.pick([1, 2, -1])};`],
    [1, () => `k = k + 0;`],
    [3, () => `closures.push(() => k);`],
    [1, () => `closures.push(() => k++);`],
    [1, () => `closures.push(() => mix(k, ${subject.element}));`],
    [2, () => `last = k;`],
    [1, () => `last = ${subject.element};`],
    [
      1,
      () =>
        `switch (k) {\ncase ${at}:\ntotal = mix(total, "case");\nbreak;\ncase ${at + 1}:\ntotal = mix(total, "falls");\ndefault:\ntotal = mix(total, "default");\n}`,
    ],
    [depth > 0 ? 2 : 0, () => `for (let j = 0; j < ${random.between(0, 3)}; j++) total = mix(total, j * 10 + k);`],
    [depth > 0 ? 1 : 0, () => `for (let j = 0; j < 3; j++) {\nif (j === 1) continue outer;\ntotal = mix(total, j);\n}`],
    [
      depth > 0 ? 1 : 0,
      () => `for (let j = 0; j < 3; j++) {\nif (j === 2 && k === ${at}) break outer;\ntotal = mix(total, j);\n}`,
    ],
  ])();
}

export function generate(random: Random): string {
  const count = random.between(2, 5);
  const text: string[] = [];
  for (let index = 0; index < count; index++) {
    const subject = random.pick(subjects);
    const turns = random.between(0, 9);
    const step = random.pick([1, 1, 1, 2, 3, -1, -1, -2, -3]);
    const start = step > 0 ? random.pick([0, 0, 0, 1, 2, -2]) : random.pick([3, 4, 5, 8, 0]);
    const strict = random.chance(0.6);
    const end = start + step * turns;
    const test = step > 0 ? (strict ? `k < ${end}` : `k <= ${end - 1}`) : strict ? `k > ${end}` : `k >= ${end + 1}`;
    const bound =
      random.chance(0.2) && step === 1
        ? `k < ${subject.length}`
        : random.chance(0.1) && turns > 0
          ? `k !== ${end}`
          : test;
    const advance =
      step === 1
        ? random.pick(["k++", "++k", "k += 1"])
        : step === -1
          ? random.pick(["k--", "--k", "k -= 1"])
          : step > 0
            ? `k += ${step}`
            : `k -= ${-step}`;
    const at = start + step * random.below(Math.max(turns, 1));
    const body = Array.from({ length: random.between(1, 4) }, () => statement(random, subject, at, 1));
    // A counter that the body moves may never meet a bound that asks for one value.
    const writes = body.some(line => /k \+= |k\+\+\)/.test(line));
    const head = `for (${random.chance(0.85) ? "let" : "var"} k = ${start}; ${writes && bound.includes("!==") ? test : bound}; ${advance})`;
    const isTag = subject.parameters.startsWith("strings");
    const extra = isTag && random.chance(0.7) ? random.pick(aboutStrings) + "\n" : "";
    const guard = `if (++spins > 200) throw new Failure("spins");\n`;
    text.push(
      `function loop${index}(${subject.parameters}) {\n${subject.before}\nlet total = 0;\nlet last = "none";\nconst closures = [];\n${extra}outer: ${head} {\n${guard}${body.join("\n")}\n}\nfor (const closure of closures) total = mix(total, closure());\nreturn mix(total, last);\n}`,
    );
    text.push(
      `for (let turn = 0; turn < ${random.pick([3, 300, 300, 3000])}; turn++) {\nspins = 0;\ntry {\nsay("${index} " + loop${index}${subject.call});\n} catch (error) {\nsay("${index} threw " + (error instanceof Failure ? error.total : error.constructor.name));\n}\n}`,
    );
  }
  return `const seen = new Set();
let previous;
let spins = 0;
const kept = [];
class Failure {
constructor(total) {
this.total = total;
}
}
const counts = {};
function say(line) {
const label = line[0];
counts[label] = (counts[label] ?? 0) + 1;
if (counts[label] <= 60 || counts[label] % 97 === 0) seen.add(line);
}
function keep(value) {
if (kept.length < 4) kept.push(value);
}
function mix(total, value) {
const text = String(total) + "," + String(value);
let hash = 7;
for (let at = 0; at < text.length; at++) hash = (Math.imul(hash, 31) + text.charCodeAt(at)) | 0;
return hash;
}
${text.join("\n")}
console.log([...seen].join("\\n"));
console.log(kept.length, kept.every(value => Object.isFrozen(value)));
`;
}

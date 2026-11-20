// `let id = 0; const next = () => ++id`: a module variable, a captured variable or a static field that a program steps by one.
// A compiler may conclude that such a variable holds an integer no larger than 2 ** 53 and keep it as an int32 where it can.
// Each scene varies what that rests on: where the counting starts (near 2 ** 31, near 2 ** 53, a fraction, -0, text, a BigInt, an
// object with valueOf), how it is stepped, what else writes it (seldom, through a pattern, a for-in or a callback) and how the
// number can be seen (as a key, as text, divided, through Object.is).
import type { Random } from "./random";

const starts = [
  "0",
  "0",
  "0",
  "1",
  "-1",
  "2147483645",
  "-2147483646",
  "1073741822",
  "4294967293",
  "9007199254740989",
  "9007199254740992",
  "-9007199254740990",
  "-9007199254740992",
  "0.5",
  "-0",
  "1e300",
  "NaN",
  "Infinity",
];
const strangeStarts = ['word("5")', 'word("text")', "true", "null", "undefined", "3n", "{ valueOf() { return 7; } }"];

const steps = ["N++", "N--", "++N", "--N", "N += 1", "N -= 1", "N = N + 1", "N = N - 1", "N = 1 + N"];

/** Expressions that look at the number. X is the variable or a copy of it. */
const uses = [
  "X",
  "X | 0",
  "X >>> 0",
  "X * 2",
  "X * X",
  "X / 2",
  "X % 3",
  "-X",
  "1 / X",
  "Object.is(X, -0)",
  "String(X)",
  "`${X}`",
  "typeof X",
  "listS[X]",
  "tableS[X]",
  "mapS.get(X)",
  "JSON.stringify({ id: X })",
  "X === 2147483648",
  "X > 2147483647",
  "X === 9007199254740992",
  "Math.floor(X)",
  "Math.abs(X)",
  "Number.isInteger(X)",
  "Number.isSafeInteger(X)",
  "X + 0.5",
  "X - 0.5",
  'X + ""',
  "X + X",
  "Math.imul(X, 3)",
  "X < 0.75",
  "X ** 2",
  "({ id: X, kind: 1 }).id",
  "[X, X][1]",
  "X ? 1 : 2",
];

const writers = [
  "N = 0.5",
  "N = 2147483648",
  "N = -0",
  "N = 2 ** 53",
  "N = 1e21",
  "N = NaN",
  "[N] = [1.5]",
  "({ v: N } = { v: 2.5 })",
  "[1].forEach(() => { N = 0.25; })",
  "for (N of [3.5, 4.5]);",
  'N = CAST(word("12"))',
  "N *= 2",
  "N /= 2",
  "N <<= 30",
  "N = N + 0.5",
  'N = CAST(N + word("1"))',
  "N = CAST(undefined)",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const cast = (code: string) => (typed ? `(${code} as unknown as number)` : code);
  const failure = typed ? "(error as Error).name" : "error.name";
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const isPlain = random.chance(0.4);
    const start = isPlain
      ? random.pick(["0", "0", "1", "2147483645", "9007199254740989"])
      : random.chance(0.25)
        ? cast(random.pick(strangeStarts))
        : random.pick(starts);
    const place = random.pick(["module", "module", "closure", "closure", "object ids", "static", "async"]);
    const name = place === "static" ? `Holder${scene}.n` : `n${scene}`;
    const fill = (code: string) =>
      code
        .replace(/\bN\b/g, name)
        .replace(/\b(list|table|map)S\b/g, `$1${scene}`)
        .replace(/CAST\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner: string) => cast(inner));
    const stepping = random
      .sample(steps, isPlain ? 1 : random.between(1, 2))
      .map(fill)
      .join("; ");
    const isCopied = random.chance(0.5);
    const shown = (isCopied ? "copy" : name).replace(/\$/g, "$$$$");
    const asked = random
      .sample(uses, isPlain ? 1 : random.between(1, 4))
      .map(use => fill(use).replace(/\bX\b/g, shown));
    const answer = `[${asked.map(use => `String(${use})`).join(", ")}].join(" ")`;
    const writer = isPlain || random.chance(0.4) ? "" : fill(random.pick(writers));
    const turns = random.pick([14, 60, 400, 3000]);
    const at = random.below(Math.min(turns, 40));
    const copy = isCopied ? `const copy = ${name};\n    ` : "";
    const isIds = place === "object ids";
    const body = `${place === "async" ? "async " : ""}function step${scene}(i${as("number")}) {
    ${place === "async" ? "await null;\n    " : ""}${stepping};
    ${isIds ? `rows${scene}[i & 7] = { id: ${name}, kind: "row" };\n    ` : ""}${copy}return ${
      isIds ? `${answer} + " " + rows${scene}[(i + 3) & 7]?.id` : answer
    };
  }
  function other${scene}() {
    ${writer};
  }`;
    const declared = `let n${scene}${as("number")} = ${start};`;
    const holder =
      place === "closure"
        ? `const { step${scene}, other${scene} } = (function () {
  ${declared}
  ${body}
  return { step${scene}, other${scene} };
})();`
        : place === "static"
          ? `class Holder${scene} {
  static n${as("number")} = ${start};
}
${body}`
          : `${declared}
${body}`;
    const call = `said = ${place === "async" ? "await " : ""}step${scene}(i);`;
    const drive = `let hash = 0;
  let last = "";
  for (let i = 0; i < ${turns}; i++) {
    ${writer ? `if (i === ${at}) other${scene}();\n    ` : ""}let said = "";
    try {
      ${call}
    } catch (error) {
      said = "threw " + ${failure};
    }
    for (let at = 0; at < said.length; at++) hash = (hash * 31 + said.charCodeAt(at)) | 0;
    last = said;
  }
  console.log("scene ${scene}", hash, last);`;
    scenes.push(`const list${scene} = [10, 20, 30, 40];
const table${scene}${as("Record<number, string>")} = { 0: "zero", 1: "one", 2147483647: "large" };
const map${scene} = new Map${typed ? "<number, string>" : ""}([[0, "zero"], [1, "one"], [2147483648, "over"]]);
const rows${scene}${as("{ id: number; kind: string }[]")} = [];
${holder}
${
  place === "async"
    ? `chain = chain.then(async () => {
  ${drive}
});`
    : `{
  ${drive}
}`
}`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${
    typed ? " as (text: string) => string" : ""
  };
let chain${as("Promise<void>")} = Promise.resolve();
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}

// `for (..) { a = a === 9 ? 3 : 9; out += text(a) + " "; }`: a short loop around a call that allocates. One path through the
// body gives a variable the same value in every iteration, another path, taken less often, gives it something else, and the
// next iteration reads what the last one left. A compiler that makes a fast copy of such a loop may take the variable for
// the one value that the common path gives it. Each scene is one small function with one or two such variables, one or two
// counters and one use that allocates; it prints the value in every iteration.
import type { Random } from "./random";

/** Statements that give `a` (a number) its next value. `x` counts the iterations. */
const updates = [
  "a = a === 9 ? 3 : 9;",
  "a = a === 9 ? 3 : 9;",
  "a = a === 9 ? 3 : 9;",
  "if (a === 9) a = 3;\n    else a = 9;",
  "a = a === nine ? three : nine;",
  "if (a !== 9) a = 9;\n    else a = x;",
  "a = x % PERIOD === PERIOD - 1 ? 3 : 9;",
  "if (x % PERIOD === 0) a = 3;\n    else a = 9;",
  "a = a > 5 ? 3 : 9;",
  "a = known.has(a) ? 3 : 9;",
  "a = 9;\n    if (x % PERIOD === 1) a = 3;",
  "if (x % PERIOD === 1) a = a + 1;\n    else a = 9;",
  "previous = a;\n    a = previous === 9 ? 3 : 9;",
  "a = a === 9 ? 0.5 : 9;",
  "a = a === 9 ? -0 : 9;",
  "switch (a) {\n      case 9:\n        a = 3;\n        break;\n      default:\n        a = 9;\n    }",
  "a = a === 9 ? (b === 1 ? 3 : 4) : 9;",
];

/** The same for other variables of the loop. */
const others = [
  'label = label === "a" ? "b" : "a";',
  "held = held === first ? second : first;",
  "on = !on;",
  "b = b === 1 ? 2 : 1;",
  "b = a === 9 ? 1 : b + 1;",
  "",
  "",
  "",
];

/** Statements that allocate and show the variables. */
const uses = [
  'out += text(a) + " ";',
  'out += text(a) + " ";',
  'out += text((a + a) >>> 0) + " ";',
  'out += text((a + a) >>> 0) + " ";',
  'out += String(a) + " ";',
  'out = out + a + ",";',
  "kept.push({ a });",
  "kept.push([a, b]);",
  "kept.push(() => a);",
  'out += text(a) + label + held.n + (on ? "y" : "n") + b + " ";',
  "out += `${a}/${previous} `;",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.5);
    const turns = random.pick(isPlain ? [3, 8] : [3, 8, 8, 40, 300]);
    const limit = random.pick([turns * 2, turns * 2, turns, turns - 1, 6]);
    const head = random.pick(
      isPlain
        ? [`for (let x = 0; x < ${turns} && turns++ < ${limit}; x++)`]
        : [
            `for (let x = 0; x < ${turns} && turns++ < ${limit}; x++)`,
            `for (let x = 0; x < ${turns} && turns++ < ${limit}; x++)`,
            `for (let x = 0; x < ${turns}; x++)`,
            `for (let x = 0; turns++ < ${limit}; x++)`,
            `for (let x = ${turns}; x > 0 && turns++ < ${limit}; x--)`,
            `for (let x = 0; x < p && turns++ < ${limit}; x++)`,
          ],
    );
    const update = random
      .pick(isPlain ? updates.slice(0, 5) : updates)
      .replaceAll("PERIOD", String(random.pick([2, 3, 5, 7])));
    const other = isPlain ? "" : random.pick(others);
    const use = random.pick(isPlain ? uses.slice(0, 4) : uses);
    const isUsedFirst = !isPlain && random.chance(0.3);
    const exit = !isPlain && random.chance(0.2) ? `if (turns > ${limit}) break;` : "";
    const kind = random.pick(
      isPlain ? ["function", "function", "generator"] : ["function", "function", "generator", "async", "method"],
    );
    const body = `let out = "";
  let turns = 0;
  let a${as("number")} = ${random.pick(["orSeven()", "orSeven()", "7", "9", "3", "p"])};
  let b = 1;
  let previous = -1;
  let label = "a";
  let on = false;
  let held = first;
  const kept${as("unknown[]")} = [];
  ${head} {
    ${exit}
    ${isUsedFirst ? use : ""}
    ${update}
    ${other}
    ${isUsedFirst ? "" : use}
  }
  return [out.length, out.slice(0, 60), out.slice(-20), text(a), b, previous, label, on, held.n, turns, shown(kept)].join("|");`;
    const call = `(${turns}, 0.5)`;
    scenes.push(
      kind === "generator"
        ? `function* run${scene}(p${as("number")}, q${as("number")})${as("Generator<number, string, unknown>")} {\n  ${body}\n}\nconsole.log("scene ${scene}", run${scene}${call}.next().value);\nconsole.log("scene ${scene}", run${scene}${call}.next().value);`
        : kind === "async"
          ? `async function run${scene}(p${as("number")}, q${as("number")})${as("Promise<string>")} {\n  ${body}\n}\nconsole.log("scene ${scene}", await run${scene}${call});\nconsole.log("scene ${scene}", await run${scene}${call});`
          : kind === "method"
            ? `class Runs${scene} {\n  run(p${as("number")}, q${as("number")})${as("string")} {\n  ${body}\n  }\n}\nconsole.log("scene ${scene}", new Runs${scene}().run${call});\nconsole.log("scene ${scene}", new Runs${scene}().run${call});`
            : `function run${scene}(p${as("number")}, q${as("number")})${as("string")} {\n  ${body}\n}\nconsole.log("scene ${scene}", run${scene}${call});\n${random.chance(0.3) ? `for (let again = 0; again < 100; again++) run${scene}${call};\n` : ""}console.log("scene ${scene}", run${scene}${call});`,
    );
  }
  return `function text(x${as("number")})${as("string")} {
  return Object.is(x, -0) ? "-0" : String(x);
}
function orSeven(x${typed ? "?: number" : ""})${as("number")} {
  return x === undefined ? 7 : x;
}
function shown(kept${as("unknown[]")})${as("string")} {
  return kept.length + ":" + kept.slice(0, 12).map(each => (typeof each === "function" ? each() : JSON.stringify(each))).join("");
}
const three${as("number")} = 3;
const nine${as("number")} = 9;
const known = new Set${typed ? "<number>" : ""}([0, 9, 4.5]);
const first = { n: 1 };
const second = { n: 2 };
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}

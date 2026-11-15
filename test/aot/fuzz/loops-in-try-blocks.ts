// A loop over a string, a list or a range stands inside a try block, and one turn may throw, return, break or continue. The
// compiler may treat such a loop like any other: count its turns ahead, write several turns out, keep sums in registers,
// make the string flat in front of the loop. The catch block, the finally block and the code after them must still see the
// counter, the sums and everything the finished turns stored exactly as they were when the turn left the loop.
import type { Random } from "./random";

/** Loop heads. `i` is declared outside the try block. */
const heads = [
  "for (i = 0; i < text.length; i++)",
  "for (i = 0; i < list.length; i++)",
  "for (i = 0; i + 1 < list.length; i++)",
  "for (i = 0; i + 2 < text.length; i += 2)",
  "for (i = 0; i < list.length - 1; i++)",
  "for (i = list.length - 1; i >= 0; i--)",
  "for (i = 0; i < limit; i++)",
  "for (i = 1; i * i <= limit * 4; i++)",
  "for (i = 0; i < 8; i++)",
  "for (const item of list)",
  "for (const letter of text)",
  "for (const step of steps(limit))",
  "for (const [at, item] of list.entries())",
];

/** Statements of a turn. `stop` is the turn that leaves the loop, or -1. */
const turns = [
  "sum += text.charCodeAt(i);",
  "sum += text.charCodeAt(i) || 0;",
  "sum += list[i];",
  "sum += list[i] + list[i + 1];",
  "sum += list[i] ?? 100;",
  "seen += text[i];",
  "seen += text.charAt(i) + i;",
  "out.push(i);",
  "kept[i] = { i };",
  'table["k" + i] = i;',
  "sum += total(list);",
  "for (let j = 0; j < 3; j++) sum += j * i;",
  "sum += 0.5;",
  "count++;",
  'if (count++ === stop) throw new Error("stopped");',
  'if (count++ === stop) throw new Error("stopped");',
  "if (count++ === stop) risky();",
  "if (count++ === stop) nothing.member;",
  "if (count++ === stop) break;",
  'if (count++ === stop) return "returned " + sum + " " + i + " " + seen;',
  "if (count++ % 3 === 0) continue;",
  "if (count++ % 4 === 1) {\n        i++;\n        continue;\n      }",
  "if (count === stop) list.length = 2;",
  "if (list.length < 12) list.push(count);",
  'if (text.length < 30) text += "x";',
  // Inside the list only: a store past the end in every turn would make the loop endless.
  "if (count === stop && i + 1 < list.length) list[i + 1] = 0.25;",
  "if (count === stop) delete list[i + 1];",
];

const catches = [
  'caught = error.name + " " + i + " " + sum + " " + seen;',
  'caught = error.name + " " + i + " " + sum + " " + seen;',
  'caught = "caught " + count + " " + out.join();',
  "caught = String(sum);\n      sum = -1;",
  "i = -5;",
];

const finals = ["", "", 'done = i + " " + sum;', "sum += 1000;", "out.push(-1);"];

const texts = ['"plain text"', '""', '"a"', 'part("joined ") + part("of two")', 'part("a longer piece of text").slice(2, 12)', '"h\\u00e9llo \\u2713 w\\u00f6rld"', 'part("x").repeat(20)']; // prettier-ignore
const lists = ["[1, 2, 3, 4, 5]", "[]", "[7]", "[1.5, 2.5, 3.5]", "[1, 2, , 4]", "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]", "Array.from({ length: 6 }, (_, at) => at * 2)"]; // prettier-ignore

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 5); scene < total; scene++) {
    const body = random.sample(turns, random.between(1, 4)).join("\n      ");
    const final = random.pick(finals);
    const rounds = random.pick([1, 1, 50, 400]);
    const calls = random
      .sample(["-1", "0", "1", "2", "4", "7"], 3)
      .map(
        stop =>
          `scene${scene}(${random.pick(texts)}, ${random.pick(lists)}${typed ? " as number[]" : ""}, ${random.pick(["0", "3", "9", "20"])}, ${stop})`,
      );
    scenes.push(`function scene${scene}(text${as("string")}, list${as("number[]")}, limit${as("number")}, stop${as("number")})${as("string")} {
  let i = 0;
  let sum = 0;
  let count = 0;
  let seen = "";
  let caught = "";
  let done = "";
  const out${as("number[]")} = [];
  const kept${as("unknown[]")} = [];
  const table${as("Record<string, number>")} = {};
  try {
    ${random.pick(heads)} {
      ${body}
    }
  } catch (${typed ? "thrown" : "error"}) {
    ${typed ? "const error = thrown as Error;\n    " : ""}${random.pick(catches)}
  }${final ? ` finally {\n    ${final}\n  }` : ""}
  return [i, sum, count, seen, caught, done, out.join(), kept.length, Object.keys(table).join(), list.length, text.length].join("|");
}
{
  let last = "";
  for (let round = 0; round < ${rounds}; round++) last = noted([${calls.join(", ")}].join(" || "));
  console.log("scene ${scene}", last, counted());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set${typed ? "<string>" : ""}();
function noted(answer${as("string")})${as("string")} {
  rounds.add(answer);
  return answer;
}
function counted()${as("string")} {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const part = (text${as("string")})${as("string")} => process.argv[9] ?? text;
const nothing${as("any")} = null;
function risky()${as("void")} {
  throw new RangeError("risky");
}
function total(list${as("number[]")})${as("number")} {
  let sum = 0;
  for (let at = 0; at < list.length; at++) sum += list[at] ?? 0;
  return sum;
}
function* steps(limit${as("number")}) {
  for (let step = 0; step < limit; step++) yield step;
}
${scenes.join("\n")}
`;
}

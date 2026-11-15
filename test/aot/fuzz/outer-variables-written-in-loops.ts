// A loop reads and writes variables of the module or of an enclosing function. The compiler may keep such a variable in a
// register for the whole loop and store it when the loop ends, as long as nobody else can see or write it meanwhile. In one
// turn of each scene somebody does: a closure reads it, another function writes it, a getter, a valueOf or a callback of a
// built-in runs, the turn throws, returns or breaks, a generator yields or an async function awaits. What the observer saw,
// and the variables after the loop or after the throw, are printed.
import type { Random } from "./random";

/** Statements of a turn that only compute. */
const work = [
  "count += i & 3;",
  "count += i & 3;\n    if (count > 64) {\n      sum = (sum + count) | 0;\n      count = 0;\n    }",
  "sum += count;",
  "count++;",
  "sum = (sum + i) | 0;",
  "sum += 0.5;",
  "count = (count * 3 + 1) % 1000;",
  "text += i % 10;",
  "sum += list[i & 3];",
  "if (count > 10) count -= 7;",
  "last = i;",
  // These run nobody's code, and throw in the turn that finds nothing there.
  "sum += rows[i].x;",
  "sum += (i === stop ? nothing : rows[0]).x;",
  "const { x } = rows[i];\n    count += x;",
  "count += rows[i & 15].x;",
];

/** Statements for the one turn in which somebody else looks or writes. */
const events = [
  "seen.push(peek());",
  "bump();",
  "table[i % table.length]();",
  "nothing.member;",
  "risky();",
  'return "early " + count;',
  "break;",
  "sum += +watcher;",
  "sum += holder.value;",
  "[1].forEach(() => {\n        count += 5;\n      });",
  "[1].forEach(() => seen.push(peek()));",
  "seen.push(String(watcher));",
  "count = sum;",
  "again(depth);",
  "PAUSE",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const event = random.pick(events);
    const kind = event === "PAUSE" ? random.pick(["generator", "async"]) : "plain";
    const pause = kind === "generator" ? "yield count;" : "await null;";
    const body = random.sample(work, random.between(1, 3));
    const at = random.between(0, body.length);
    const isEveryTurn = random.chance(0.15) && !/return|break|member|risky|again|PAUSE/.test(event);
    body.splice(at, 0, `${isEveryTurn ? "" : "if (i === stop) "}{\n      ${event.replace("PAUSE", pause)}\n    }`);
    const head = random.pick(["for (let i = 0; i < n; i++)", "for (let i = 0; i < n; i++)", "for (let i = n - 1; i >= 0; i--)", "for (let i = 0; i < list.length * n; i += 2)"]); // prettier-ignore
    const keyword = kind === "generator" ? "function*" : kind === "async" ? "async function" : "function";
    const result = kind === "generator" ? "Generator<number, string>" : kind === "async" ? "Promise<string>" : "string";
    const declarations = `let count = 0;
let sum = 0;
let last = 0;
let text = "";
const seen${as("(string | number)[]")} = [];
const peek = ()${as("string")} => count + ":" + sum + ":" + last + ":" + text;
function bump()${as("void")} {
  count += 100;
  sum = -1;
}
const table${as("(() => void)[]")} = [bump, () => seen.push(peek())];
const watcher = {
  valueOf()${as("number")} {
    seen.push(count);
    return 1;
  },
  toString()${as("string")} {
    count += 2;
    return "watched";
  },
};
const holder = {
  get value()${as("number")} {
    seen.push(peek());
    return count;
  },
};
function again(depth${as("number")})${as("void")} {
  if (depth < 2) ${kind === "plain" ? "seen.push(loop(5, 2, depth + 1));" : "bump();"}
}
${keyword} loop(n${as("number")}, stop${as("number")}, depth${as("number")})${as(result)} {
  ${head} {
    ${body.join("\n    ")}
  }
  return "ended " + count;
}`;
    const run =
      kind === "generator"
        ? `try {
    const steps = loop(N, STOP, 0);
    for (let step = steps.next(); ; step = steps.next()) {
      answers.push(String(step.value) + "@" + peek());
      bump();
      if (step.done) break;
    }
  } catch (error) {
    answers.push("threw " + ${typed ? "(error as Error)" : "error"}.name + "@" + peek());
  }`
        : kind === "async"
          ? `try {
    const pending = loop(N, STOP, 0);
    answers.push("started " + peek());
    bump();
    answers.push((await pending) + "@" + peek());
  } catch (error) {
    answers.push("threw " + ${typed ? "(error as Error)" : "error"}.name + "@" + peek());
  }`
          : `answers.push(String(told(() => loop(N, STOP, 0))) + "@" + peek());`;
    const runs = random
      .sample(["0", "1", "3", "9", "-1"], 2)
      .map(stop => run.replace("N", random.pick(["4", "12", "60", "300"])).replace("STOP", stop))
      .join("\n  ");
    const isInFunction = random.chance(0.5);
    // The variables belong to the module, each scene in a block of its own, or to a function around the loop.
    scenes.push(
      isInFunction
        ? `${kind === "async" ? "async " : ""}function scene${scene}()${as(kind === "async" ? "Promise<string>" : "string")} {
  ${declarations.replaceAll("\n", "\n  ")}
  const answers${as("string[]")} = [];
  ${runs.replaceAll("\n", "\n  ")}
  return answers.join(" | ") + " seen " + seen.join();
}
console.log("scene ${scene}", ${kind === "async" ? "await " : ""}scene${scene}());`
        : `{
  ${declarations.replaceAll("\n", "\n  ")}
  const answers${as("string[]")} = [];
  ${runs.replaceAll("\n", "\n  ")}
  console.log("scene ${scene}", answers.join(" | "), "seen", seen.join());
}`,
    );
  }
  return `const list = [1, 2, 3, 4];
const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(x => ({ x }));
const nothing${as("any")} = null;
function risky()${as("void")} {
  throw new RangeError("risky");
}
function told(ask${as("() => unknown")})${as("unknown")} {
  try {
    return ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
${scenes.join("\n")}
`;
}

// `await f(x)` where f is async and comes to its end without waiting for anything. The compiler may call f's body directly and
// hand its answer to the await without a promise in between, as long as nothing can tell: the caller still goes on one job
// later, an answer with a `then` still takes three, and an error still arrives as a rejection. Each scene picks what f answers
// or throws, how it is called and what stands around the await, starts two callers beside a chain of jobs that count, and
// prints the order in which everything happened.
import type { Random } from "./random";

/** Bodies of the async function `f(x)`. */
const bodies = [
  "return x + 1;",
  "return x + 1;",
  'return "text" + x;',
  "return { n: x };",
  "return { n: x, m: [x] };",
  "return [x];",
  "return undefined;",
  "",
  "return null;",
  "return x > 0;",
  "return x / 4;",
  "return new Point(x);",
  "return given;",
  "return x % 2 ? x : { n: x };",
  'return x % 2 ? x : { then: (resolve) => (log.push("then called"), resolve("from then")) };',
  'return { then: (resolve) => (log.push("then called"), resolve(x)) };',
  'return { get then() {\n    log.push("then read");\n    return undefined;\n  }, n: x };',
  "return { then: 5, n: x };",
  "return new Waiting(x);",
  "return Promise.resolve(x);",
  "return other(x);",
  "return await other(x);",
  'throw new RangeError("at once");',
  'if (x % 2) throw new TypeError("for odd ones");\n  return x;',
  "return missing.member;",
  "if (x < 0) await null;\n  return x;",
  "if (x === 1) await null;\n  return x;",
  'try {\n    return x;\n  } finally {\n    log.push("finally of f");\n  }',
  'try {\n    throw new Error("inside");\n  } catch {\n    return x;\n  }',
  "return deep(x);",
];

/** Expressions that call f and wait. */
const waits = [
  "await f(ARG)",
  "await f(ARG)",
  "await f(ARG)",
  "(await f(ARG), await f(ARG))",
  "await (0, f)(ARG)",
  "await table[ARG % table.length](ARG)",
  "await holder.f(ARG)",
  "await f.call(null, ARG)",
  "await Promise.resolve(f(ARG))",
  "await f(await f(ARG))",
  "await middle(ARG)",
  "[await f(ARG), await f(ARG + 1)][1]",
  "await (ARG % 2 ? f(ARG) : ARG)",
  "(await Promise.all([f(ARG), f(ARG + 1)]))[0]",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 4); scene < total; scene++) {
    const body = random.pick(bodies);
    // TypeScript refuses a comma whose left side does nothing.
    const wait = random.pick(typed ? waits.filter(each => !each.includes("(0, f)")) : waits);
    const isLooped = random.chance(0.25);
    const text = `async function f(x${as("number")})${as("Promise<any>")} {
  ${typed ? body.replaceAll("(resolve)", "(resolve: (value: unknown) => void)").replace("missing.member", "(missing as any).member") : body}
}
async function other(x${as("number")})${as("Promise<number>")} {
  return x * 2;
}
async function middle(x${as("number")})${as("Promise<any>")} {
  return f(x);
}
const table = [f, other];
const holder = { f };
async function caller(tag${as("string")}, x${as("number")})${as("Promise<void>")} {
  log.push(tag + " begins");
  try {
    ${
      isLooped
        ? `let sum = 0;\n    for (let i = 0; i < 40; i++) sum += Number(${wait.replaceAll("ARG", "(x + i)")}) || 1;\n    log.push(tag + " sum " + sum);`
        : `const got = ${wait.replaceAll("ARG", "x")};\n    log.push(tag + " got " + typeof got + " " + (got?.n ?? String(got)));`
    }
  } catch (error) {
    log.push(tag + " caught " + ${typed ? "(error as Error)" : "error"}.name);
  } finally {
    log.push(tag + " ends");
  }
}
{
  const all = [ticks(${isLooped ? 3 : 7}), caller("a", ${random.pick([0, 1, 2, 3])}), caller("b", ${random.pick([0, 1, 2, 3])})];
  log.push("started");
  await Promise.all(all);
  console.log("scene ${scene}", log.splice(0).join(" | "));
}`;
    scenes.push(text.replace(/\b(f|other|middle|table|holder|caller)\b(?!:)/g, `$1${scene}`).replaceAll(`holder${scene}.f${scene}`, `holder${scene}.f`).replaceAll(`{ f${scene} }`, `{ f: f${scene} }`)); // prettier-ignore
  }
  return `const log${as("string[]")} = [];
const missing${as("unknown")} = undefined;
const given${as("unknown")} = process.argv[9] ?? { n: "given" };
class Point {
  n${as("number")};
  constructor(n${as("number")}) {
    this.n = n;
  }
}
class Waiting extends Point {
  then(resolve${as("(value: unknown) => void")}) {
    log.push("then of the class");
    resolve("waited " + this.n);
  }
}
function deep(x${as("number")})${as("number")} {
  return x > 2 ? deep(x) + 1 : x;
}
// Jobs that count, so that the log shows how many jobs later a caller went on.
function ticks(count${as("number")})${as("Promise<unknown>")} {
  let chain${as("Promise<unknown>")} = Promise.resolve();
  for (let i = 0; i < count; i++) chain = chain.then(() => log.push("job " + i));
  return chain;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}

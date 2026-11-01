// ./everyday/<group>.txt holds many small idioms, one under each line `//// <name>`: TypeScript that declares `function turn(i: number): number`, or the same
// function async. everydayIdioms() puts each into a program of the form of ./idioms: a loop that calls turn() as often as ./idioms/host.ts says.
// With `foundAtRunTime` the loop finds turn() in a property of the global object, and turn() begins with a branch that is never taken, long enough that neither the
// compiler nor the JIT copies turn() into the loop: it stays a function of its own with one caller, as most functions of a large program are, and both pay for the call.
// With a third of the length the JIT copies it in, and whether the compiler does hangs on a budget of its inliner: then the table measures that budget.
// That alone is not enough: the compiler sees which function the property holds and may copy turn() into the loop all the same, where it stands in a loop of the text and
// counts as code that runs often. So turn() also begins with a call of itself that is never made: a function that calls itself is copied into nobody. The call is no tail
// call: that one the compiler would turn into a loop around the whole of turn().
// With `benchIsCalledOnce` the function that holds the loop is called once, as main(), run() and the body of a test are, and not in a loop of the module's code.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const root = join(import.meta.dir, "everyday");

// A program of over four times this limit is very large: there only what stands in a loop of the text, or has four callers, counts as code that runs often. They go with `foundAtRunTime`.
export const flagsOfVeryLargeProgram = ["--aot-limit=MaxWarmCodeValues:1"];

const neverTaken = `
  if (i < 0) {
    let t = i | 0;
${Array.from({ length: 48 }, (_, k) => `    t = ((t ^ ${k + 5}) * 3) | 0;`).join("\n")}
    (globalThis as any).neverStored = t;
  }`;

const neverCallsItself = (isAsync: boolean) => `
  if (i < -1) return ${isAsync ? "(await turn(i + 1))" : "turn(i + 1)"} + 1;`;

function program(text: string, foundAtRunTime: boolean, benchIsCalledOnce: boolean) {
  const isAsync = /^async function turn\b/m.test(text);
  if (foundAtRunTime)
    text = text.replace(
      /^(?:async )?function turn\(i: number\): (?:number|Promise<number>) \{/m,
      head => head + neverCallsItself(isAsync) + neverTaken,
    );
  const callee = foundAtRunTime ? "found" : "turn";
  return `import { nextTurns } from "../host.ts";
${text.trim()}${foundAtRunTime ? "\n(globalThis as any).turnOfThisProgram = turn;" : ""}
${isAsync ? "async function bench(n: number)" : "function bench(n: number): number"} {${foundAtRunTime ? "\n  const found: typeof turn = (globalThis as any).turnOfThisProgram;" : ""}
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + ${isAsync ? `(await ${callee}(i))` : `${callee}(i)`}) | 0;
  return sum;
}
${
  benchIsCalledOnce
    ? `const answer = ${isAsync ? "(await bench(nextTurns(0)))" : "bench(nextTurns(0))"} & 0xffffff;
nextTurns(answer);`
    : `let answer = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(answer)) answer = (answer + ${isAsync ? "(await bench(n))" : "bench(n)"}) & 0xffffff;`
}
console.log(answer);
`;
}

export function everydayIdioms(foundAtRunTime = false, benchIsCalledOnce = false) {
  const idioms: { name: string; text: string }[] = [];
  for (const file of readdirSync(root).sort()) {
    const [, ...sections] = readFileSync(join(root, file), "utf8").split(/^\/\/\/\/ /m);
    for (const section of sections) {
      const end = section.indexOf("\n");
      idioms.push({
        name: `everyday-${file.slice(0, -4)}/${section.slice(0, end).trim()}`,
        text: program(section.slice(end + 1), foundAtRunTime, benchIsCalledOnce),
      });
    }
  }
  return idioms;
}

/** Each as TypeScript into `typed`, beside what writeTypedIdioms() has put there, and as the same text without its types into `untyped`, beside what writeUntypedIdioms() has. */
export function writeEverydayIdioms(typed: string, untyped: string, foundAtRunTime = false, benchIsCalledOnce = false) {
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: false, inline: false });
  const idioms = everydayIdioms(foundAtRunTime, benchIsCalledOnce);
  for (const { name, text } of idioms) {
    mkdirSync(dirname(join(typed, name)), { recursive: true });
    mkdirSync(dirname(join(untyped, name)), { recursive: true });
    writeFileSync(join(typed, name + ".ts"), text);
    writeFileSync(join(untyped, name + ".js"), transpiler.transformSync(text));
  }
  return idioms.map(idiom => idiom.name);
}

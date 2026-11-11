// The types of a JavaScript file come out of its code. So a large one, which the build begins ahead of the others, asks about
// the code of what it imports, and finds functions there whose results depend on one another. Who comes to such a ring first
// decides what it gives, so a task that is not known to be the first is thrown away and its file is looked at again later.
//
// The build therefore looks first at what the large JavaScript files import, begins each of them when its own imports have
// been taken, and looks again at a file that was thrown away once all that it imports is final. None of that changes what
// the program does, on one thread or on many.
//
// With BUN_JSC_logAOTPhaseTimes=1 the build says in one line for each round how many files were heavy and how many went first.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { buildEnvironment, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const smallFiles = 300;
const functionsOfLargeFile = 400;

// Two functions whose results depend on one another, and a value that depends on both.
function smallFile(index: number) {
  return `
export function even${index}(n) { return n === 0 ? { even: true, steps: 0 } : odd${index}(n - 1); }
export function odd${index}(n) { return n === 0 ? { even: false, steps: 0 } : { ...even${index}(n - 1), steps: n }; }
export const held${index} = { at: ${index}, first: even${index}(${index % 7}) };
`;
}

// It imports a few small files and the other large file, which imports it.
function largeFile(name: string, other: string, from: number) {
  let source = `import { of_${other} } from "./${other}.js";\n`;
  for (let index = from; index < from + 20; index++)
    source += `import { even${index}, held${index} } from "./small/s${index}.js";\n`;
  for (let index = 0; index < functionsOfLargeFile; index++) {
    const small = from + (index % 20);
    source += `function f${index}(n) { return n <= 0 ? held${small}.first : { ...even${small}(n), next: f${(index + 1) % functionsOfLargeFile}(n - 1).steps }; }\n`;
  }
  source += `export function of_${name}(n) { return n <= 0 ? 0 : f0(n).steps + of_${other}(n - 1); }\n`;
  return source;
}

// The other small files are imported by files that are small themselves.
function files() {
  const all: Record<string, string> = { "package.json": `{ "type": "module" }` };
  let main = `import { of_a } from "./a.js";\nimport { of_b } from "./b.js";\nlet sum = of_a(5) + of_b(4);\n`;
  for (let index = 0; index < smallFiles; index++) all[`small/s${index}.js`] = smallFile(index);
  for (let group = 0; group < smallFiles / 5; group++) {
    let source = "export let sum = 0;\n";
    for (let index = group * 5; index < group * 5 + 5; index++)
      source += `import { odd${index} } from "./small/s${index}.js";\nsum += odd${index}(${index % 5}).steps;\n`;
    all[`group${group}.js`] = source;
  }
  // A chain, so that no file names many others.
  for (let group = 0; group < smallFiles / 5; group++)
    all[`group${group}.js`] += group ? `import { sum as before } from "./group${group - 1}.js";\nsum += before;\n` : "";
  main += `import { sum as rest } from "./group${smallFiles / 5 - 1}.js";\nsum += rest;\n`;
  all["a.js"] = largeFile("a", "b", 100);
  all["b.js"] = largeFile("b", "a", 200);
  all["main.js"] = main + `console.log(sum);\n`;
  return all;
}

test("the program does what it does in Bun, on one thread and on eight", async () => {
  using dir = tempDir("aot-heavy-javascript-files", files());
  const directory = String(dir);
  const expected = await run([bunExe(), "main.js"], directory, bunEnv);
  expect(expected.exitCode).toBe(0);
  for (const threads of [1, 8]) {
    const executable = join(directory, `main${threads}${isWindows ? ".exe" : ""}`);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", withThreads(threads), "main.js", "--outfile", executable],
      directory,
      { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
    );
    expect(built.exitCode).toBe(0);
    expect((await run([executable], directory, bunEnv)).stdout).toBe(expected.stdout);
    if (threads === 1) continue;
    const rounds = (built.stderr + built.stdout)
      .split("\n")
      .filter(line => line.startsWith("AOT round of the checker | all threads | "));
    const wentFirst = rounds.map(line => Number(/, (\d+) that those import go first/.exec(line)?.[1] ?? -1));
    // Forty small files are imported by the two large ones.
    expect(Math.max(...wentFirst)).toBe(40);
  }
}, 240_000);

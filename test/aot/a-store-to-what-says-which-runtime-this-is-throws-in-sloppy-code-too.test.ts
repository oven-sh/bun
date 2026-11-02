import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(240_000);

// The compiler folds reads of process.versions.node, process.versions.bun and process.release.name, so an executable may not change the three. They are locked as the built-in
// objects are: the change throws in sloppy code too, and the message names the member. A .cjs file is sloppy code, a .mjs file strict.
const members = ["process.versions.node", "process.versions.bun", "process.release.name"];
// The build cannot fold a read by a name that it does not know, so such a read tells what the object really holds.
const unread = (name: string) => `[${JSON.stringify(name)}].join(globalThis.neverSet ?? "")`;
const changes: [string, (holder: string, name: string) => string][] = [
  ["a store", (holder, name) => `${holder}.${name} = "first"`],
  ["a store by a name that the build cannot read", (holder, name) => `${holder}[${unread(name)}] = "second"`],
  ["a definition", (holder, name) => `Object.defineProperty(${holder}, ${JSON.stringify(name)}, { value: "third" })`],
  ["a deletion", (holder, name) => `delete ${holder}.${name}`],
];

const program = members
  .flatMap(member => {
    const holder = member.slice(0, member.lastIndexOf("."));
    const name = member.slice(member.lastIndexOf(".") + 1);
    return changes.map(
      ([change, text]) => `{
  const before = ${holder}[${unread(name)}];
  let how = "taken";
  try { ${text(holder, name)}; } catch (error) { how = error.constructor.name + ": " + error.message.split(" because ")[0]; }
  console.log(${JSON.stringify(`${member}, ${change}:`)}, how + ",", ${holder}[${unread(name)}] === before ? "unchanged" : "changed");
}`,
    );
  })
  .join("\n");
const others = `process.versions.v8 = "mine"; process.versions.added = "mine"; delete process.versions.uv; process.release.sourceUrl = "mine";
console.log(process.versions.v8, process.versions.added, typeof process.versions.uv, process.release.sourceUrl);
console.log(Object.getOwnPropertyDescriptor(process.versions, "node").writable, Object.keys(process.versions).slice(0, 2).join());
`;
const files = {
  "sloppy.cjs": others + program,
  "strict.mjs": others + program,
  "changes.test.mjs": `import { test } from "bun:test";\ntest("the changes", () => {\n  import.meta.require("./sloppy.cjs");\n});\n`,
};

const linesFor = (answer: (member: string, change: string) => string) =>
  members.flatMap(member => changes.map(([change]) => `${member}, ${change}: ${answer(member, change)}`));
const othersAnswer = ["mine mine undefined mine", "true node,bun"];

const answersIn = (stdout: string) => stdout.split("\n").filter(line => /^(process\.|mine |true )/.test(line));
const refusal = (member: string, change: string) =>
  `TypeError: Cannot ${change === "a deletion" ? "delete" : "assign to"} ${member}, unchanged`;

for (const file of ["sloppy.cjs", "strict.mjs"]) {
  test.concurrent(`plain Bun takes every change: ${file}`, async () => {
    using directory = tempDir("runtime-identity-plain", files);
    const { stdout, exitCode } = await run([bunExe(), "run", `./${file}`], String(directory), bunEnv);
    expect(answersIn(stdout)).toEqual([...othersAnswer, ...linesFor(() => "taken, changed")]);
    expect(exitCode).toBe(0);
  });

  test.concurrent(`an executable refuses every change aloud: ${file}`, async () => {
    using directory = tempDir("runtime-identity-executable", files);
    const executable = join(String(directory), isWindows ? "program.exe" : "program.out");
    const build = [bunExe(), "build", "--compile", "--aot", `./${file}`, "--outfile", executable];
    expect(await run(build, String(directory), bunEnv)).toMatchObject({ exitCode: 0 });
    const { stdout, exitCode } = await run([executable], String(directory), bunEnv);
    expect(answersIn(stdout)).toEqual([...othersAnswer, ...linesFor(refusal)]);
    expect(exitCode).toBe(0);
  });
}

// A test may pose as another runtime, as under plain `bun test`, so a test run does not fold the two versions. It folds process.release.name.
for (const [form, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])
  test.concurrent(`a test run ${form} takes the versions and refuses the name aloud`, async () => {
    using directory = tempDir("runtime-identity-test-run", files);
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout } = await run([bunExe(), "test", "--aot", "./changes.test.mjs"], String(directory), env);
    expect(answersIn(stdout)).toEqual([
      ...othersAnswer,
      ...linesFor((member, change) => (member === "process.release.name" ? refusal(member, change) : "taken, changed")),
    ]);
  });

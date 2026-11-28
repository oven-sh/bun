// A read of Bun under a key that nobody knows may be a read under any name: every member may be used, however the read is written. So it is where the program hands Bun to code
// that the build cannot see. A text that is handed nothing may name any member itself: that is a name known only at run time, and for --trim it does not count.
// Each read is a program of its own: the report says once for a program that Bun escapes, so beside another read one that no longer lets Bun go would be hidden.
// Such a program is open, and its build compiles all of Bun's library, which is what a case costs. The library stays in: without it a build counts fewer members for the reads
// through import() and require().
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

/** The members of Bun that the report counts as used by a program, and how the check ended. */
async function membersUsed(program: string) {
  using dir = tempDir("aot-members-of-bun-named-through-unseen-code", { "program.mjs": program });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "program.mjs"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const prefix = "aot: trim: uses Bun ";
  const used = stderr
    .split("\n")
    .filter(line => line.startsWith(prefix))
    .map(line => line.slice(prefix.length));
  // A check that fails makes no report: all that it says on stderr is why it failed.
  return { used, stdout, exitCode, ...(exitCode !== 0 && { stderr }) };
}

// An error or a warning of the build would stand on stdout.
const cleanly = { stdout: "", exitCode: 0 };

const launder = `const launder = Function("value", process.argv[9] ?? "return value");\n`;
const everyMember = "(escapes, so any member may be used)";
const members = Object.getOwnPropertyNames(Bun);

const reads: [string, string, string][] = [
  ["Reflect.get", "", `Reflect.get(Bun, process.argv[2])`],
  ["Reflect.get with a receiver", "", `Reflect.get(Bun, process.argv[2], Bun)`],
  ["brackets", "", `Bun[process.argv[2]]`],
  ["brackets behind ?.", "", `Bun?.[process.argv[2]]`],
  ["brackets round String()", "", `Bun[String(process.argv[2])]`],
  ["brackets round a template", "", "Bun[`${process.argv[2]}`]"],
  ["a call", "", `Bun[process.argv[2]]({}, {})`],
  ["a pattern", "", `(({ [process.argv[2]]: member }) => member)(Bun)`],
  ["Reflect.getOwnPropertyDescriptor", "", `Reflect.getOwnPropertyDescriptor(Bun, process.argv[2]).value`],
  ["Object.getOwnPropertyDescriptor", "", `Object.getOwnPropertyDescriptor(Bun, process.argv[2]).value`],
  ["a key in a parameter", `const read = key => Bun[key];\n`, `read(process.argv[2])`],
  ["Bun out of a field", "", `({ bun: Bun }).bun[process.argv[2]]`],
  ["globalThis.Bun", "", `globalThis.Bun[process.argv[2]]`],
  ["import()", "", `(await import("bun"))[process.argv[2]]`],
  ["require()", "", `require("bun")[process.argv[2]]`],
  ["an object made below Bun", "", `Object.create(Bun)[process.argv[2]]`],
  ["a copy of Bun", "", `({ ...Bun })[process.argv[2]]`],
  ["a proxy of Bun", "", `new Proxy(Bun, {})[process.argv[2]]`],
  ["a Bun that went the same way", launder, `launder(Bun)[launder("deepMatch")]`],
  [
    "a callback of the unseen text",
    `const call = Function("callback", "value", process.argv[9] ?? "return callback(value)");\n`,
    `call(name => Bun[name], "deepMatch")`,
  ],
  [
    "the unseen text, which is handed Bun",
    "",
    `Function("bun", "name", process.argv[9] ?? "return bun[name]")(Bun, "deepMatch")`,
  ],
];

test.concurrent.each(reads)("read by %s", async (_, first, read) => {
  const { used, ...ended } = await membersUsed(`${first}console.log(typeof (${read}));\n`);
  expect(ended).toEqual(cleanly);
  expect(used).toContain(everyMember);
  // Every member counts as used: what native code makes, and what code of Bun makes.
  expect(members.filter(name => !used.includes(name))).toEqual([]);
});

test.concurrent.each([
  ["written in place", `Bun["deepMatch"]`],
  ["in a constant", `(() => {\n  const key = "deepMatch";\n  return Bun[key];\n})()`],
])("a key that the build can read, %s, names one member", async (_, read) => {
  expect(await membersUsed(`console.log(typeof (${read}));\n`)).toEqual({ used: ["deepMatch"], ...cleanly });
});

test.concurrent("a text from run time may name any member itself, and no such name counts as a use", async () => {
  const { used, ...ended } = await membersUsed(`${launder}console.log(launder(1), typeof Bun.version);\n`);
  expect(ended).toEqual(cleanly);
  expect(used).toContain("version");
  expect(used).not.toContain("deepMatch");
  expect(used).not.toContain("sql");
  // The text opens the program, and an open program holds Bun's library, whose own code names a few members.
  expect(used.length).toBeLessThan(members.length / 4);
});

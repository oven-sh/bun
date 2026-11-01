// Some operations throw only if memory runs out: flattening a text that was put together, cutting a part out of it, looking a text up in a Map. The compiler takes that error for
// one that nobody observes, and moves things across such an operation that it would not move across any other throw. No ordinary test takes that edge: it needs a text of a
// billion characters and a limit on memory.
//
// `--aot-sabotage=MemoryRunsOutWhenCounted` (hidden) puts a counter in front of each such operation, behind all optimizations. An ordinary build holds none of it. What throws is
// said at run time, so one build serves many runs:
//   BUN_AOT_OUT_OF_MEMORY_AT=<n>                        the n-th such operation that runs throws the RangeError that plain Bun throws
//   BUN_AOT_OUT_OF_MEMORY_AT=<module>:<line>:<column>:<k>  the k-th that runs at that place in the source
//   BUN_AOT_OUT_OF_MEMORY_AT=flattening:<k>             the k-th that meets a text which is still to be flattened: whichever operation that is in this build
//   BUN_AOT_OUT_OF_MEMORY_AT=list                       nothing throws; each is named on stderr as it runs
// Plain Bun cannot be made to throw there, so it is no reference. `--aot-sabotage=MemoryRunsOutWhenCountedByRule` is: the same counter, in a build that was told that
// these operations throw by rule. The two builds differ in that one assumption, and have to answer alike under the same key.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const counted = "--aot-sabotage=MemoryRunsOutWhenCounted";
const countedByRule = "--aot-sabotage=MemoryRunsOutWhenCountedByRule";

// The build must not know how long the text is: operations on a text that it can see whole cannot throw.
const program = `const half = "\\u0100".repeat(Number(process.argv[9] ?? 16));
const texts = ["a", half + half, "b"];
function codes(texts) {
  const seen = [];
  for (const text of texts) {
    try {
      seen.push(text.charCodeAt(0));
    } catch (error) {
      seen.push(error.name + ": " + error.message);
    }
  }
  return seen.join();
}
console.log(codes(texts));
`;
const undisturbed = "97,256,98\n";
const thrown = "RangeError: Out of memory";

async function build(flags: string[]) {
  const dir = tempDir("aot-memory-runs-out", { "program.js": program });
  const executable = join(String(dir), isWindows ? "app.exe" : "app");
  built(
    await spawned(
      [bunExe(), ...compileCommand, ...flags, join(String(dir), "program.js"), "--outfile", executable],
      String(dir),
      env,
    ),
  );
  const run = async (at?: string) => {
    const ran = await spawned(
      [executable],
      String(dir),
      at === undefined ? env : { ...env, BUN_AOT_OUT_OF_MEMORY_AT: at },
    );
    return {
      stdout: ran.stdout,
      exitCode: ran.exitCode,
      named: [...ran.stderr.matchAll(/^AOT: memory (?:runs out|could run out) at (\S+ \w+)$/gm)].map(match => match[1]),
    };
  };
  return { dir, run };
}

test("plain Bun prints what the tests below take for undisturbed", async () => {
  using dir = tempDir("aot-memory-runs-out", { "program.js": program });
  const plain = await spawned([bunExe(), join(String(dir), "program.js")], String(dir), env);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: undisturbed, exitCode: 0 });
}, 300_000);

test("an ordinary build holds none of it", async () => {
  const { dir, run } = await build([]);
  using _ = dir;
  for (const at of [undefined, "1", "flattening:1", "list"])
    expect({ at, ...(await run(at)) }).toEqual({ at, stdout: undisturbed, exitCode: 0, named: [] });
}, 300_000);

test.each([counted, countedByRule])(
  "%s: the operation that is named throws, the try around it catches, and nothing else changes",
  async flag => {
    const { dir, run } = await build([flag]);
    using _ = dir;
    expect(await run()).toEqual({ stdout: undisturbed, exitCode: 0, named: [] });

    const listed = await run("list");
    expect({ stdout: listed.stdout, exitCode: listed.exitCode }).toEqual({ stdout: undisturbed, exitCode: 0 });
    const operations = listed.named.filter(name => name.endsWith(" operation"));
    // One place in the source, once for each text; one of the three is still to be flattened.
    expect(operations).toEqual([operations[0], operations[0], operations[0]]);
    expect(listed.named.filter(name => name.endsWith(" flattening"))).toEqual([
      operations[0].replace(" operation", " flattening"),
    ]);
    const place = operations[0].split(" ")[0];

    const answers = [`${thrown},256,98\n`, `97,${thrown},98\n`, `97,256,${thrown}\n`];
    for (const [index, stdout] of answers.entries()) {
      expect(await run(String(index + 1))).toEqual({ stdout, exitCode: 0, named: [operations[0]] });
      expect(await run(`${place}:${index + 1}`)).toEqual({ stdout, exitCode: 0, named: [operations[0]] });
    }
    expect(await run("flattening:1")).toEqual({ stdout: answers[1], exitCode: 0, named: [`${place} flattening`] });

    // One past the last: nothing is named, which is how a sweep knows where to end.
    for (const at of ["4", `${place}:4`, "flattening:2"])
      expect({ at, ...(await run(at)) }).toEqual({ at, stdout: undisturbed, exitCode: 0, named: [] });
  },
  300_000,
);

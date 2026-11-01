import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { crossedLoops } from "./harness/crossed-loops";
import { run } from "./harness/run";
import { test } from "./supported";

// AOT_CROSSED_LOOPS="<first seed> <programs> <functions in each>" asks for others.
const [firstSeed, programs, functions] = (process.env.AOT_CROSSED_LOOPS ?? "1 6 40").split(" ").map(Number);

async function builtAndRun(name: string, source: string) {
  using dir = tempDir("aot-crossed-loops", { [name]: source });
  const executable = join(String(dir), isWindows ? "out.exe" : "out");
  const plain = await run([bunExe(), name], String(dir), bunEnv);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./" + name, "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({ output: built.exitCode ? built.stdout + built.stderr : "", exitCode: built.exitCode }).toEqual({
    output: "",
    exitCode: 0,
  });
  const { stdout, exitCode } = await run([executable], String(dir), bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: plain.stdout, exitCode: plain.exitCode });
  return plain;
}

// The jump into the loop that `yield*` is lowered to is not laid, and its two headers reach one another.
test("a yield* behind a finally that returns", async () => {
  const source = `function* inner() {}
function* made() {
  try {
  } finally {
    return "from finally";
  }
  yield* inner();
}
console.log(made().next().value);
`;
  expect((await builtAndRun("main.js", source)).stdout).toBe("from finally\n");
});

test.each(Array.from({ length: programs }, (_, index) => firstSeed + index))(
  "nested and crossed loops, seed %d",
  async seed => {
    const plain = await builtAndRun("main.mjs", crossedLoops(seed, functions));
    expect({ lines: plain.stdout.split("\n").length - 1, exitCode: plain.exitCode }).toEqual({
      lines: functions,
      exitCode: 0,
    });
  },
);

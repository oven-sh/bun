import { expect } from "bun:test";
import { bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Built with --aot-log-type-mismatches, an executable reports a value that contradicts its type and goes on. The type that
// a parameter is held to may be named nowhere else in the program.
test("a log build reports an argument that does not fit its parameter and goes on", async () => {
  using dir = tempDir("aot-audit-of-arguments", {
    "main.ts": `
      class Full {
        static derive(props: { step: number }, state: { from: number }) { return props.step !== state.from ? { from: props.step } : null; }
      }
      const untyped: any = Full;
      console.log(JSON.stringify(untyped.derive({ step: 1 }, "text")));
      console.log(JSON.stringify(untyped.derive(5, { from: 2 })));
      console.log("went on");
    `,
  });
  const outfile = join(String(dir), isWindows ? "out.exe" : "out");
  const { stderr: buildErrors, exitCode: buildCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "--aot-log-type-mismatches", "./main.ts", "--outfile", outfile],
    String(dir),
  );
  expect({ buildErrors: buildErrors.split("\n").filter(line => line.startsWith("error")), buildCode }).toEqual({
    buildErrors: [],
    buildCode: 0,
  });
  const { stdout, stderr, exitCode } = await run([outfile], String(dir));
  expect({ last: stdout.trim().split("\n").at(-1), exitCode }).toEqual({ last: "went on", exitCode: 0 });
  expect(stderr.split("\n").filter(line => line.startsWith("[aot] type-mismatch ")).length).toBeGreaterThan(0);
}, 60_000);

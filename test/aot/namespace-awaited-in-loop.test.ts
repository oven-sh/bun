import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const programs: Record<string, string> = {
  "a namespace object": `
    import * as ns from "./a";
    let held: typeof ns | Promise<typeof ns> = ns;
    for (let i = 0; i < 3; i++) held = await held;
    console.log((await held).f(1));
  `,
  "the promise of import()": `
    let held: Promise<typeof import("./a")> | typeof import("./a") = import("./a");
    for (let i = 0; i < 3; i++) held = await held;
    console.log((await held).f(1));
  `,
  "a namespace object awaited four times": `
    import * as ns from "./a";
    console.log((await (await (await (await ns)))).f(1));
  `,
};

test.concurrent.each(Object.keys(programs))(
  "the build ends and the program runs: %s is awaited again and again",
  async name => {
    using dir = tempDir("namespace-awaited-in-loop", {
      "a.ts": `export function f(x: number): number { return x + 1; }\nexport function nobodyCallsThis(): number { return 0; }\n`,
      "main.ts": programs[name],
    });
    const outfile = join(String(dir), isWindows ? "out.exe" : "out");
    const { stderr: buildErrors, exitCode: buildCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile],
      String(dir),
    );
    expect({ buildErrors: buildErrors.split("\n").filter(line => line.startsWith("error")), buildCode }).toEqual({
      buildErrors: [],
      buildCode: 0,
    });
    const { stdout, exitCode } = await run([outfile], String(dir));
    expect({ stdout, exitCode }).toEqual({ stdout: "2\n", exitCode: 0 });
  },
  60_000,
);

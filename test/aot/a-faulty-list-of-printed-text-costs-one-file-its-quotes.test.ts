// What an error quotes reads as `bun run` prints it: `null[0x10]` is quoted 'null[16]'. The build makes a list for that, one a file.
// A fault in such a list is a bug of the compiler's, and all that the list buys is wording. So it costs no build: the list of that file is
// dropped, the build says so in one line, and the messages of that file quote its text as written. No other file loses anything.
// A Bun with assertions stops the build instead, so that our own tests and fuzzers go on finding such faults.
// --aot-sabotage=ListsOfPiecesEndInAPiece cuts the first list short.
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test } from "./supported";

const quoting = (written: string) => `try {
  ${written};
} catch (error) {
  console.log(error.message);
}
`;
const sources = {
  "main.js": `import "./other.js";\n${quoting("null[0x10]")}`,
  "other.js": quoting("null[0x20]"),
};
const message = (quoted: string) => `null is not an object (evaluating '${quoted}')`;
const hasAssertions = isASAN || isDebug;
const sabotage = "--aot-sabotage=ListsOfPiecesEndInAPiece";

describe("compile/aot/a faulty list of printed text costs one file its quotes", () => {
  const folder = String(tempDir("aot-faulty-list-of-printed-text", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const build = (name: string, flags: string[]) => {
    const executable = join(folder, isWindows ? `${name}.exe` : name);
    const command = [bunExe(), ...compileCommand, ...withoutDebugInformation, ...flags, "./main.js"];
    return { executable, ended: spawned([...command, "--outfile", executable], folder, bunEnv) };
  };
  const warnings = (stderr: string) => stderr.split("\n").filter(line => line.includes("TS100077"));

  test("a sound list: no warning, and the quotes of bun run", async () => {
    const plain = await spawned([bunExe(), "./main.js"], folder, bunEnv);
    expect(plain.stdout).toBe(`${message("null[32]")}\n${message("null[16]")}\n`);
    const { executable, ended } = build("sound", []);
    const said = await ended;
    built(said);
    expect(warnings(said.stderr)).toEqual([]);
    expect((await spawned([executable], folder, bunEnv)).stdout).toBe(plain.stdout);
  });

  test.skipIf(hasAssertions)("a faulty list: one warning, and that file is quoted as written", async () => {
    const { executable, ended } = build("faulty", [sabotage]);
    const said = await ended;
    built(said);
    const [warning, ...more] = warnings(said.stderr);
    expect(more).toEqual([]);
    expect(warning).toStartWith("warn: TS100077: Error messages quote the code of ");
    expect(warning).toEndWith("This is a bug in Bun: the list of printed text ends inside a piece");
    const isOfMain = warning.includes("main.js");
    expect(warning.includes("other.js")).toBe(!isOfMain);
    const run = await spawned([executable], folder, bunEnv);
    expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({
      stdout: `${message(isOfMain ? "null[32]" : "null[0x20]")}\n${message(isOfMain ? "null[0x10]" : "null[16]")}\n`,
      exitCode: 0,
    });
  });

  test.skipIf(!hasAssertions)("a faulty list stops the build of a Bun with assertions", async () => {
    const said = await build("refused", [sabotage]).ended;
    expect(said.exitCode).not.toBe(0);
    expect(said.stderr).toContain("internal compiler error (LinkAndEmit)");
    expect(said.stderr).toContain("the list of printed text ends inside a piece");
    expect(warnings(said.stderr)).toEqual([]);
  });
});

import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { runTool, testaot } from "../engine/testaot";
import { without } from "../harness/capabilities";
import { built, slot, spawned } from "../harness/commands";
import { withProgramOutput } from "../harness/flags";
import { describe, test } from "../supported";

const program = {
  "app.ts": `
import { EventEmitter } from "node:events";

function sum(value: number): number {
  return value <= 0 ? 0 : value + sum(value - 1);
}

const emitter = new EventEmitter();
emitter.on("value", (value: number) => console.log(sum(value)));
emitter.emit("value", 6);
`,
};

const programFile = "program.aot";

function headersOf(lines: string[], name: string) {
  return lines.filter(line => line.startsWith("function ") && line.includes(` name="${name}" `));
}

// No Bun prints IR. Every Bun writes the program that its front end hands to the engine, and testaot prints it.
async function buildAndPrintProgram(folder: string) {
  const writesProgram = withProgramOutput(join(folder, programFile));
  const command = [bunExe(), "build", "--compile", "--aot", writesProgram, "app.ts", "--outfile", "app"];
  built(await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" }));
  const { lines, stderr, exitCode } = await runTool([testaot!, "print", programFile], folder);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  return lines;
}

describe("declared types of Bun's own modules", () => {
  test.skipIf(!!without("testaot"))(
    "are kept, as the program's are",
    () =>
      slot(async () => {
        using dir = tempDir("aot-library-types", program);
        const folder = String(dir);
        const lines = await buildAndPrintProgram(folder);

        const library = headersOf(lines, "emit").filter(line => line.includes(" role=Library "));
        expect(library.length).toBeGreaterThan(0);
        expect(library.some(header => header.includes("IsChecked"))).toBe(true);

        const own = headersOf(lines, "sum");
        expect(own.length).toBeGreaterThan(0);
        expect(own.some(header => header.includes("IsChecked"))).toBe(true);

        expect(
          await spawned([join(folder, isWindows ? "app.exe" : "app")], folder, { ...bunEnv, NO_COLOR: "1" }),
        ).toMatchObject({ stdout: "21\n", exitCode: 0 });
      }),
    300_000,
  );
});

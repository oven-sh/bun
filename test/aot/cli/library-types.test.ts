import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { describe, printIR, test, writesProgramInto } from "../harness/printed-ir";
import { built, slot, spawned } from "../run-programs";

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

function headersOf(dump: string, name: string) {
  return dump.split("\n").filter(line => line.startsWith("function ") && line.includes(` name="${name}" `));
}

async function dumpFunction(folder: string, name: string) {
  const command = [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), "app.ts", "--outfile", "app"];
  built(await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" }));
  return headersOf(await printIR(folder, { until: "Select", functionName: name }), name);
}

describe("declared types of Bun's own modules", () => {
  test(
    "are kept, as the program's are",
    () =>
      slot(async () => {
        using dir = tempDir("aot-library-types", program);
        const folder = String(dir);

        const library = (await dumpFunction(folder, "emit")).filter(line => line.includes(" role=Library "));
        expect(library.length).toBeGreaterThan(0);
        expect(library.some(header => header.includes("IsChecked"))).toBe(true);

        const own = await dumpFunction(folder, "sum");
        expect(own.length).toBeGreaterThan(0);
        expect(own.some(header => header.includes("IsChecked"))).toBe(true);

        expect(
          await spawned([join(folder, isWindows ? "app.exe" : "app")], folder, { ...bunEnv, NO_COLOR: "1" }),
        ).toMatchObject({ stdout: "21\n", exitCode: 0 });
      }),
    300_000,
  );
});

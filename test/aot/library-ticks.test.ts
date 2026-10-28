// Bun's own modules queue their work with a shortcut: where process.nextTick is still the function that the library installed, they
// write the tick into the ring themselves. The test of that is a comparison of process.nextTick with a function of the library, which
// are one object. A compiler that takes them for two folds the test away, and every tick of a stream, a socket or a request goes
// through process.nextTick.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe, printIR, test, writesProgramInto } from "./harness/printed-ir";
import { built, spawned } from "./run-programs";

const program = `
  import { Readable } from "node:stream";
  const readable = new Readable({ read() {} });
  readable.on("close", () => console.log("closed"));
  readable.destroy();
`;

function bodyOf(dump: string, name: string) {
  const lines = dump.split("\n");
  const start = lines.findIndex(
    line => line.startsWith("function ") && line.includes(` name="${name}" `) && line.includes(" role=Library "),
  );
  expect(start).toBeGreaterThanOrEqual(0);
  return lines.slice(start, lines.indexOf("}", start));
}

describe("the ticks of the library", () => {
  for (const shortcut of ["queueTick1", "queueTick2"]) {
    test(`${shortcut} asks whether process.nextTick is the library's own`, async () => {
      using dir = tempDir("aot-library-ticks", { "main.mjs": program });
      const folder = String(dir);
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", writesProgramInto(folder), "main.mjs", "--outfile", "main"],
          folder,
          { ...bunEnv, NO_COLOR: "1" },
        ),
      );
      const body = bodyOf(await printIR(folder, { until: "Select", functionName: shortcut }), shortcut);
      expect(body.some(line => line.includes(" = StrictEq "))).toBe(true);
      expect(body.some(line => line.includes(" = CallDirect "))).toBe(true);
    }, 240_000);
  }
});

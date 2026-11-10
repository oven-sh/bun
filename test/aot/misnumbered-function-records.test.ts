// A function whose record is not one of the shared ones finds it in a table sorted by function. In every build the runtime checks, once, that each record of that table belongs to a function that is marked.
// Fault injection, --aot-testing=MisnumberFunctionRecords: each record is listed under the number after its function's. Where functions with such records lie side by side, a lookup would find its neighbor's record.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0" };
const files = {
  "entry.mjs": `import "./prelude.mjs";
await import("./main.ts");
`,
  "prelude.mjs": `globalThis.print = (...values) => console.log(values.join(" "));
globalThis.report = value => console.log(String(value));
globalThis.id = value => value;
`,
  "main.ts": `declare function print(...values: unknown[]): void;
declare function id<T>(value: T): T;
function fails(depth: number): number { if (depth === 0) throw new Error("down"); return fails(depth - 1) + 1; }
class Thing { get answer(): number { return fails(id(1)); } static make(): Thing { return new Thing(); } }
async function later(): Promise<number> { return Thing.make().answer; }
let told = "";
try { told = String(Thing.make().answer); } catch (error) { told = String((error as Error).stack).split("\\n").length > 1 ? "has frames" : "has none"; }
later().catch((error: Error) => print(told, typeof error.stack));
`,
};

describe.skipIf(!!unsupported)("function records", () => {
  test("under another function's number stop the process", () =>
    slot(async () => {
      using dir = tempDir("aot-function-records", files);
      const folder = String(dir);
      const build = (name: string, ...flags: string[]) =>
        spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...withoutDebugInformation,
            ...flags,
            "./entry.mjs",
            "--outfile",
            name,
          ],
          folder,
          env,
        );
      const run = (name: string) => spawned([join(folder, isWindows ? `${name}.exe` : name)], folder, env);
      expect((await build("right")).exitCode).toBe(0);
      const right = await run("right");
      expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({
        stdout: "has frames string\n",
        exitCode: 0,
      });
      expect((await build("injected", "--aot-testing=MisnumberFunctionRecords")).exitCode).toBe(0);
      const injected = await run("injected");
      expect({ stdout: injected.stdout, stderr: injected.stderr }).toEqual({
        stdout: "",
        stderr: expect.not.stringContaining("error: down"),
      });
      expect(injected.exitCode).not.toBe(0);
    }));
});

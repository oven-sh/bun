// When only Object.defineProperty() gives a field its value, the field's slot is planned with the attributes that the definition creates: { writable: false } on a missing property creates one
// that is read-only, not enumerable and not configurable. An allocation creates a plain data property. --aot-check=Validate rejects an allocation, a store or a copy of own keys that writes such a slot.
// The injected fault, --aot-testing=TreatLiteralFieldsAsDefined, stops counting an object literal's initial fields as plain writes. Without the check, the executable silently loses the key.
// Under ForceStraightCompilation nothing is verified, so that path leaves such an allocation to the walk.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { expectFaultyBuild } from "./harness/fault-injection";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const program = `interface Options { host?: string; port?: number }
function server(host: string, port: number) { return { host, port }; }
function start(opts: Options = {}) {
  const s = server(opts.host ?? "localhost", opts.port ?? 80);
  Object.defineProperty(s, "host", { writable: false });
  return JSON.stringify(s);
}
console.log(start());
`;
const fault = "TreatLiteralFieldsAsDefined";

describe.skipIf(!!unsupported)("a plain write to a field planned as defined", () => {
  test("stops the build under the check, with and without ForceStraightCompilation", () =>
    slot(async () => {
      using dir = tempDir("aot-defined-field", { "main.ts": program });
      const folder = String(dir);
      const build = (outfile: string, ...flags: string[]) =>
        spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...withoutDebugInformation,
            ...flags,
            "./main.ts",
            "--outfile",
            outfile,
          ],
          folder,
          env,
        );
      const outputOf = async (outfile: string) =>
        (await spawned([join(folder, isWindows ? outfile + ".exe" : outfile)], folder, env)).stdout;

      expect((await build("right", "--aot-check=Validate")).exitCode).toBe(0);
      expect(await outputOf("right")).toBe('{"host":"localhost","port":80}\n');
      expect((await build("straight", "--aot-check=Validate", "--aot-testing=ForceStraightCompilation")).exitCode).toBe(
        0,
      );
      expect(await outputOf("straight")).toBe('{"host":"localhost","port":80}\n');

      const message = 'an allocation writes a field that only definitions may write: L1.field0 "host"';
      const silent = await build("silent", `--aot-testing=${fault}`);
      if (expectFaultyBuild(silent, message)) expect(await outputOf("silent")).toBe('{"port":80}\n');

      for (const testing of [fault, `ForceStraightCompilation,${fault}`]) {
        const stopped = await build("stopped", "--aot-check=Validate", `--aot-testing=${testing}`);
        expect(stopped.stderr).toContain(message);
        expect(stopped.exitCode).toBe(1);
      }
    }));
});

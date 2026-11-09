// Where definitions alone give a field its values, its slot is planned in the form that a definition creates: { writable: false } on a name that is not there creates a property that is
// read-only, not enumerable and not configurable. A birth creates the plain form. --aot-check=Validate refuses a birth, a store and a copy of own keys that fill such a slot.
// THE LIE: --aot-testing=TreatLiteralFieldsAsDefined: what a literal holds at its birth does not count as written without a definition. Without the check the executable
// loses the key in silence. Where bodies are written straight nothing is verified: the straight allocation leaves such a birth to the walk.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
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
const lie = "TreatLiteralFieldsAsDefined";

describe.skipIf(!!unsupported)("a birth that fills a slot planned in the form that definitions create", () => {
  test("stops the build under the check, walked or written straight", () =>
    slot(async () => {
      using dir = tempDir("aot-form-of-definitions", { "main.ts": program });
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
      const said = async (outfile: string) =>
        (await spawned([join(folder, isWindows ? outfile + ".exe" : outfile)], folder, env)).stdout;

      expect((await build("right", "--aot-check=Validate")).exitCode).toBe(0);
      expect(await said("right")).toBe('{"host":"localhost","port":80}\n');
      expect((await build("straight", "--aot-check=Validate", "--aot-testing=WritesBodiesStraight")).exitCode).toBe(0);
      expect(await said("straight")).toBe('{"host":"localhost","port":80}\n');

      const refusal =
        'a birth fills a field whose slot is planned in the form that definitions create: L1.field0 "host"';
      const silent = await build("silent", `--aot-testing=${lie}`);
      // A Bun that is built with assertions or a sanitizer verifies the code of every unit: there this build is refused as the ones below.
      if (isASAN || isDebug) {
        expect(silent.stderr).toContain(refusal);
        expect(silent.exitCode).toBe(1);
      } else {
        expect(silent.exitCode).toBe(0);
        expect(await said("silent")).toBe('{"port":80}\n');
      }

      for (const words of [lie, `WritesBodiesStraight,${lie}`]) {
        const stopped = await build("stopped", "--aot-check=Validate", `--aot-testing=${words}`);
        expect(stopped.stderr).toContain(refusal);
        expect(stopped.exitCode).toBe(1);
      }
    }));
});

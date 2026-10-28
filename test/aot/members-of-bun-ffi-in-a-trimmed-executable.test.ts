// Bun.FFI is the object behind bun:ffi. Each program names one member of it and nothing else of bun:ffi, so that member alone has to keep the feature in a trimmed executable.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./run-programs";

const calls = {
  toBuffer: "Bun.FFI.toBuffer(-1)",
  toArrayBuffer: "Bun.FFI.toArrayBuffer(-1)",
  viewSource: "Bun.FFI.viewSource({})",
  callback: "Bun.FFI.callback({}, {})",
  closeCallback: "Bun.FFI.closeCallback({})",
  "toBuffer through a variable": "(({ toBuffer }) => toBuffer(-1))(Bun.FFI)",
};

const programFor = (call: string) => `try {
  console.log("answers", typeof ${call});
} catch (error) {
  console.log("throws", error.name, error.code, error.message);
}
`;

if (!canTrim)
  console.error(
    "SKIPPED: members-of-bun-ffi-in-a-trimmed-executable.test.ts: this build of Bun doesn't support --trim",
  );

(canTrim && !unsupported && !isWindows ? describe.concurrent : describe.skip)(
  "a trimmed executable calls the member of Bun.FFI that it names",
  () => {
    test.each(Object.entries(calls))(
      "%s",
      (_, call) =>
        slot(async () => {
          using dir = tempDir("members-of-bun-ffi", { "program.js": programFor(call) });
          const folder = String(dir);
          const plain = await spawned([bunExe(), "program.js"], folder, bunEnv);
          built(
            await spawned(
              [bunExe(), "build", "--compile", "--aot", "--trim", "program.js", "--outfile", "trimmed"],
              folder,
              bunEnv,
            ),
          );
          const trimmed = await spawned([join(folder, "trimmed")], folder, bunEnv);
          expect(plain.stdout).not.toBe("");
          expect({ stdout: trimmed.stdout, exitCode: trimmed.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
        }),
      600_000,
    );
  },
);

// A ShadowRealm runs the modules that come with the runtime from their source, so an executable holds that source where the program names ShadowRealm.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./run-programs";

const programs = {
  "names.mjs": `const realm = new ShadowRealm();
console.log(await realm.importValue("node:path", "sep") === (await import("node:path")).sep);
console.log((await realm.importValue("node:util", "format"))("%s-%d", "a", 1));
console.log(realm.evaluate("typeof process.nextTick"));
`,
  "evaluates.mjs": `console.log(await (0, eval)(process.argv[2]));
`,
};
const namedInText = `new globalThis["Shadow" + "Realm"]().importValue("node:path", "sep").then(() => "imported", error => error.name)`;

if (!canTrim)
  console.error("SKIPPED: a-shadow-realm-in-a-trimmed-executable.test.ts: this build of Bun doesn't support --trim");

(canTrim && !unsupported ? describe.concurrent : describe.skip)("an executable of a Bun that can be trimmed", () => {
  async function build(folder: string, program: string, flags: string[]) {
    const executable = join(folder, program.replace(".mjs", flags.length ? "-trimmed" : "-whole"));
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", ...flags, program, "--outfile", executable],
        folder,
        bunEnv,
      ),
    );
    return executable;
  }

  test.each([[[]], [["--trim"]]])(
    "built with %j lets a ShadowRealm import the modules of the runtime",
    flags =>
      slot(async () => {
        using dir = tempDir("a-shadow-realm", programs);
        const folder = String(dir);
        const ran = await spawned([await build(folder, "names.mjs", flags)], folder, bunEnv);
        expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
          stdout: "true\na-1\nfunction\n",
          stderr: "",
          exitCode: 0,
        });
      }),
    600_000,
  );

  test(
    "holds the source of those modules only where the program names ShadowRealm",
    () =>
      slot(async () => {
        using dir = tempDir("a-shadow-realm", programs);
        const folder = String(dir);
        const ran = await spawned([await build(folder, "evaluates.mjs", []), namedInText], folder, bunEnv);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "TypeError\n", exitCode: 0 });
      }),
    600_000,
  );
});

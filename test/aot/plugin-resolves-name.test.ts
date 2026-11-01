import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The build finds nothing under "aliased", and a plugin that the run brings answers for it. The loader of the run time is asked, as for `virtual:config`.
const common = {
  "preload.ts": `
    import { plugin } from "bun";
    plugin({
      name: "alias",
      setup(build) {
        build.onResolve({ filter: /^(aliased|@scope\\/aliased|\\.\\/no-such-file)$/ }, () => ({ path: import.meta.dir + "/target.ts" }));
      },
    });`,
  "target.ts": `console.log("the target runs"); export const which = "the target";`,
};
// What a build with assertions checks, in every build: JavaScript is entered nowhere where the engine forbids it.
const env = { ...bunEnv, NO_COLOR: "1", BUN_JSC_crashOnDisallowedVMEntry: "1" };
const say = `error => console.log(error.name, error.code, error.message.split(" from ")[0].split("\\n")[0])`;
const forms: Record<string, string> = {
  "import()": `
    import { test } from "bun:test";
    test("alias", async () => {
      console.log((await import("aliased")).which, (await import("@scope/aliased")).which, (await import("./no-such-file")).which);
      await import("nobody-answers").catch(${say});
    });`,
  "require()": `
    import { test } from "bun:test";
    test("alias", () => {
      console.log(require("aliased").which, require("@scope/aliased").which, require("./no-such-file").which);
      try { require("nobody-answers"); } catch (error) { (${say})(error); }
    });`,
  "an import statement": `
    import { test } from "bun:test";
    import { which } from "aliased";
    import * as scoped from "@scope/aliased";
    export { which as again } from "./no-such-file";
    test("alias", () => console.log(which, scoped.which));`,
  "an optional dependency": `
    import { test } from "bun:test";
    let optional;
    try { optional = require("nobody-answers"); } catch {}
    test("alias", async () => console.log(typeof optional, (await import("aliased")).which));`,
};

async function runTests(folder: string, flags: string[]) {
  const command = [bunExe(), "test", ...flags, "--preload", "./preload.ts", "./x.test.ts"];
  const { stdout, stderr, exitCode } = await run(command, folder, env);
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each(Object.keys(forms))(
  "a name that only a plugin of the run resolves: %s",
  async form => {
    using dir = tempDir("plugin-resolves-name", { ...common, "x.test.ts": forms[form] });
    const plain = await runTests(String(dir), []);
    expect(plain).toMatchObject({ counts: [" 1 pass", " 0 fail"], exitCode: 0 });
    expect(plain.printed).toContain("the target");
    expect(await runTests(String(dir), ["--aot"])).toEqual(plain);
  },
  240_000,
);

// An executable holds what the build found, and the error for the name is worded by the host's resolver, which is asked where no JavaScript may run: a plugin whose filter matches
// was called there. A release build refused the call in silence, and an assertion stopped the others.
test("the error of an executable is made without calling the plugin", async () => {
  using dir = tempDir("plugin-resolves-name-executable", {
    "entry.js": `
      Bun.plugin({ name: "alias", setup(build) { build.onResolve({ filter: /^aliased$/ }, () => ({ path: "/nowhere/target.js" })); } });
      await import("aliased").catch(${say});
      console.log("goes on");`,
  });
  const built = await run([bunExe(), "build", "--compile", "--aot", "./entry.js", "--outfile=entry"], String(dir), env);
  expect(built.exitCode).toBe(0);
  const { stdout, exitCode } = await run(["./entry"], String(dir), env);
  expect({ last: stdout.trim().split("\n").at(-1), exitCode }).toEqual({ last: "goes on", exitCode: 0 });
}, 240_000);

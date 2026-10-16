import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const programs: Record<string, string> = {
  "a-tag-without-a-module-specifier.js": `/**
 * @import url(partial.css) screen
 */
function lengthOf(text) {
  return text.length;
}
console.log(lengthOf("abc"));
`,
  "a-tag-inside-a-function.cjs": `exports.parse = function (text) {
  /**
   * @import url(partial.css) screen
   */
  var state = "";
  return state + text;
};
console.log(exports.parse("abc"));
`,
  "a-variable-of-the-same-name.js": `/** @import url(partial.css) screen */
var url = { _cache: 1 };
console.log(url._cache);
`,
};

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("jsdoc-import-tags", { [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir), bunEnv);
    const aot = await run([bunExe(), "run", "--aot", entry], String(dir), env);
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test("an executable built with --aot prints what bun run prints", async () => {
    using dir = tempDir("jsdoc-import-tags", { [entry]: programs[entry] });
    const plain = await run([bunExe(), "run", entry], String(dir), bunEnv);
    const build = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"], String(dir), bunEnv);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    const aot = await run([join(String(dir), "program")], String(dir), env);
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});

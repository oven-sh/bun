import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const long = Buffer.alloc(300, "a").toString();
const said = `said = error.code ?? error.constructor.name;`;

const programs: Record<string, string> = {
  "written.cjs": `let said = "loaded";\ntry {\n  require("${long}");\n} catch (error) {\n  ${said}\n}\nconsole.log(said);\n`,
  "held-by-a-constant.cjs": `const name = "${long}";\nlet said = "loaded";\ntry {\n  require(name);\n} catch (error) {\n  ${said}\n}\nconsole.log(said);\n`,
  "imported.mjs": `let said = "loaded";\ntry {\n  await import("${long}");\n} catch (error) {\n  ${said}\n}\nconsole.log(said);\n`,
  "a-folder-of-a-package.cjs": `let said = "loaded";\ntry {\n  require("package/${long}/file.js");\n} catch (error) {\n  ${said}\n}\nconsole.log(said);\n`,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("a module named by more bytes than a file name may have is a module that is not found", async () => {
  using dir = tempDir("names-too-long", programs);
  for (const entry of Object.keys(programs)) {
    const plain = await run([bunExe(), "run", entry], String(dir), bunEnv);
    const aot = await run([bunExe(), "run", "--debug-aot", entry], String(dir), {
      ...bunEnv,
      BUN_JSC_crashIfInterpreterIsUsed: "1",
    });
    expect({ entry, stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ entry, stdout: plain.stdout, exitCode: 0 });
  }
}, 120_000);

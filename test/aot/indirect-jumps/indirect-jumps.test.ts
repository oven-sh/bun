import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { cpSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { countIndirectJumps, whyTracingIsUnavailable } from "./count-indirect-jumps";

const numberOfObjects = 50;
const fieldsPerObject = 4;

const reason = await whyTracingIsUnavailable();

// TODO: it takes about two indirect jumps for each object.
(reason || isASAN || isDebug ? test.skip : test.todo)(
  "JSON.stringify of typed objects takes no indirect jump per field",
  async () => {
    using dir = tempDir("indirect-jumps", {});
    const folder = String(dir);
    for (const file of ["main.ts", "untyped.js"]) cpSync(join(import.meta.dir, file), join(folder, file));
    const executable = join(folder, "main");
    const built = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
      cwd: folder,
      env: bunEnv,
      stderr: "pipe",
    });
    expect({ stderr: built.exitCode ? built.stderr.toString() : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });

    const plain = Bun.spawnSync({ cmd: [executable], env: bunEnv, stderr: "pipe" });
    expect({ stderr: plain.stderr.toString(), exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });

    const counted = await countIndirectJumps([executable], { ...bunEnv, BUN_JSC_useGC: "0" }, 1);
    expect({ stderr: counted.stderr, exitCode: counted.exitCode, stdout: counted.stdout }).toEqual({
      stderr: "",
      exitCode: 0,
      stdout: plain.stdout.toString(),
    });
    const busiest = Math.max(0, ...counted.windows[0].values());
    expect(busiest).toBeGreaterThan(0);
    expect(busiest).toBeLessThan((numberOfObjects * fieldsPerObject) / 2);
  },
  600_000,
);

import { expect } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// macOS kills what was changed behind its signature.
test.skipIf(isMacOS)(
  "an executable whose list of package names is damaged says so where the program asks for one",
  async () => {
    const names = ["aaa-store", "bbb-store"];
    using dir = tempDir("aot-damaged-package-names", {
      "main.cjs": `const name = process.argv[2];
console.log("started");
if (name) console.log(require(name));
`,
      ...Object.fromEntries(
        names.flatMap(name => [
          [`node_modules/${name}/package.json`, `{ "name": "${name}", "version": "1.0.0", "main": "./lib.cjs" }`],
          [`node_modules/${name}/lib.cjs`, `module.exports = "this is ${name}";`],
        ]),
      ),
    });
    const outfile = join(String(dir), "built.exe");
    const entryPoints = ["./main.cjs", ...names.map(name => `./node_modules/${name}/lib.cjs`)];
    const build = [bunExe(), "build", "--compile", "--aot", ...entryPoints, "--outfile", outfile];
    const built = await run(build, String(dir), bunEnv);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const whole = await run([outfile, "bbb-store"], String(dir), bunEnv);
    expect({ stdout: whole.stdout, exitCode: whole.exitCode }).toEqual({
      stdout: "started\nthis is bbb-store\n",
      exitCode: 0,
    });

    // The names lie one behind the other, in their order.
    const bytes = readFileSync(outfile);
    const at = bytes.indexOf(Buffer.from("/node_modules/aaa-store/$bunfs"));
    expect(at).toBeGreaterThan(0);
    bytes.write("zzz", at + "/node_modules/".length);
    writeFileSync(outfile, bytes);
    chmodSync(outfile, 0o755);
    const started = await run([outfile], String(dir), bunEnv);
    expect({ stdout: started.stdout, exitCode: started.exitCode }).toEqual({ stdout: "started\n", exitCode: 0 });
    const damaged = await run([outfile, "bbb-store"], String(dir), bunEnv);
    expect(damaged.stderr).toContain("is damaged. Its embedded program can't be read.");
    expect({ stdout: damaged.stdout, exitCode: damaged.exitCode }).toEqual({ stdout: "started\n", exitCode: 1 });
  },
  120_000,
);

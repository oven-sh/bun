import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `const name = "./provider.js"; await import(/* @vite-ignore */ name)` keeps other bundlers from following the import. The name is
// written out all the same: under `bun run --aot` the file is compiled with the program, so that it is compiled code when the host
// loads it. BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if any of its files is interpreted.

const files = {
  "lib/provider.mjs": `import dep from "./dep.cjs";
export class Provider { name() { return "the provider with " + dep.name; } }
`,
  "lib/dep.cjs": `exports.name = "a CommonJS dependency";`,
  "lib/load.mjs": `// to not bundle the provider
const name = "./provider.mjs";
export async function loadProvider() {
	const { Provider } = await import(
		/* @vite-ignore */
		name
);
	return new Provider();
}
`,
  "node_modules/a-package/package.json": `{ "name": "a-package", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/a-package/index.js": `exports.name = "a package";`,
};

const programs: Record<string, string> = {
  "imported.mjs": `import { loadProvider } from "./lib/load.mjs";
console.log((await loadProvider()).name());
`,
  "required.cjs": `const name = "./lib/dep.cjs";
console.log(require(name).name);
`,
  "a-package.cjs": `const wanted = "a-package";
function load() { return require(wanted); }
console.log(load().name);
`,
  "in-a-let-and-a-var.cjs": `let first = "./lib/dep.cjs";
var second = "a-package";
console.log(require(first).name, require(second).name);
`,
  "two-of-one-name.cjs": `function one() { const name = "./lib/dep.cjs"; return require(name).name; }
function two() { const name = "a-package"; return require(name).name; }
console.log(one(), two());
`,
  "not-there.cjs": `const name = "not-installed";
try { require(name); } catch (error) { console.log(error.code); }
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("names-held-by-variables", { ...files, [entry]: programs[entry] });
    const run = async (flags: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "run", ...flags, entry], cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([], bunEnv);
    const aot = await run(["--aot"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});

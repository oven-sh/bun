import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { afterAll, test } from "./harness/default-timeout";
import { run } from "./harness/run";

const nameOfExecutable = isWindows ? "tool.exe" : "tool";

const main = `
const held = [require("./stem/lib/index.js"), require("./stem/mod.js"), require("./stem/written.ts")];
const made = text => JSON.parse(JSON.stringify(text) + " ".repeat(process.argv.length - 3));
const roads = {
  "./stem/lib": () => require(made("./stem/lib")),
  "./stem/mod": () => require(made("./stem/mod")),
  "./stem/written.js": () => require(made("./stem/written.js")),
  "./stem/lib/": () => require(made("./stem/lib/")),
  "./stem/lib/index": () => require(made("./stem/lib/index")),
  "./stem/mod.js": () => require(made("./stem/mod.js")),
  "./stem/written.ts": () => require(made("./stem/written.ts")),
};
try {
  console.log(JSON.stringify({ answer: roads[process.argv[2]]().who }));
} catch (error) {
  console.log(JSON.stringify({ threw: error.code ?? error.name }));
}
`;

const dir = tempDir("aot-a-name-that-finds-another-file", {
  "main.cjs": main,
  "stem/lib/index.js": `exports.who = "the folder, compiled";\n`,
  "stem/lib.js": `exports.who = "the file";\n`,
  "stem/mod.js": `exports.who = "js, compiled";\n`,
  "stem/mod.ts": `export const who = "ts";\n`,
  "stem/written.ts": `export const who = "ts, compiled";\n`,
  "stem/written.js": `exports.who = "js";\n`,
});
afterAll(() => dir[Symbol.dispose]());
const directory = String(dir);

const forms = { bundle: [], closed: ["--aot"], withCodeFromDisk: ["--aot", "--aot-allow-code-from-disk"] };
let built:
  Promise<(form: keyof typeof forms, name: string) => Promise<{ answer?: unknown; threw?: string }>> | undefined;
const setUp = () =>
  (built ??= (async () => {
    for (const [form, flags] of Object.entries(forms)) {
      const outfile = join(directory, "bin", form, nameOfExecutable);
      const { stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", ...flags, "./main.cjs", "--outfile", outfile],
        directory,
      );
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    return async (form, name) => {
      const { stdout, stderr, exitCode } = await run(
        [join(directory, "bin", form, nameOfExecutable), name],
        directory,
        bunEnv,
      );
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout);
    };
  })());

const names = ["./stem/lib", "./stem/mod", "./stem/written.js"];

test.each(names)(
  "where code may come from disk: %s",
  async name => {
    const ask = await setUp();
    expect(await ask("withCodeFromDisk", name)).toEqual(await ask("bundle", name));
  },
  600_000,
);

test.each(names)(
  "a closed executable refuses %s",
  async name => {
    const ask = await setUp();
    expect(await ask("closed", name)).toEqual({ threw: "MODULE_NOT_FOUND" });
  },
  600_000,
);

test("a closed executable finds the compiled files under their own names", async () => {
  const ask = await setUp();
  for (const name of ["./stem/lib/", "./stem/lib/index", "./stem/mod.js", "./stem/written.ts"])
    expect(await ask("closed", name)).toEqual(await ask("bundle", name));
}, 600_000);

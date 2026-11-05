import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { afterAll, test } from "./harness/default-timeout";
import { run } from "./harness/run";

const nameOfExecutable = isWindows ? "tool.exe" : "tool";

const main = `
const path = require("node:path");
const orm = require("orm");
const held = require("dep");
const roads = {
  load: name => orm.load(name).version,
  resolve: name => path.relative(__dirname, Bun.resolveSync(name, path.join(__dirname, "proj"))).split(path.sep).join("/"),
};
try {
  console.log(JSON.stringify({ answer: roads[process.argv[2]](process.argv[3]) }));
} catch (error) {
  console.log(JSON.stringify({ threw: error.code ?? error.name }));
}
`;

const driver = (version: string) => ({
  "package.json": JSON.stringify({ name: "driver", version, main: "./lib/index.js" }),
  "lib/index.js": `exports.version = ${JSON.stringify(version)};\n`,
});
const below = (folder: string, files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([name, text]) => [`${folder}/${name}`, text]));

const dir = tempDir("aot-a-package-that-lay-nearer", {
  "main.cjs": main,
  "node_modules/orm/index.js": `exports.load = name => require(name);\n`,
  ...below("node_modules/orm/node_modules/driver", driver("2.0.0")),
  ...below("node_modules/driver", driver("1.0.0")),
  "node_modules/dep/index.js": `exports.where = "compiled";\n`,
  "proj/node_modules/dep/index.js": `exports.where = "on disk";\n`,
});
afterAll(() => dir[Symbol.dispose]());
const directory = String(dir);

const forms = { bundle: [], closed: ["--aot"], withCodeFromDisk: ["--aot", "--aot-allow-code-from-disk"] };
type Form = keyof typeof forms | "run";
let built: Promise<(form: Form, ...words: string[]) => Promise<{ answer?: unknown; threw?: string }>> | undefined;
const setUp = () =>
  (built ??= (async () => {
    for (const [form, flags] of Object.entries(forms)) {
      const outfile = join(directory, "bin", form, nameOfExecutable);
      const entryPoints = ["./main.cjs", "./node_modules/driver/lib/index.js"];
      const { stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", ...flags, ...entryPoints, "--outfile", outfile],
        directory,
      );
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    return async (form, ...words) => {
      const command = form === "run" ? [bunExe(), "main.cjs"] : [join(directory, "bin", form, nameOfExecutable)];
      const { stdout, stderr, exitCode } = await run([...command, ...words], directory, bunEnv);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout);
    };
  })());

test.each([
  ["load", "driver"],
  ["resolve", "dep"],
])(
  "a closed executable: %s %s",
  async (...words) => {
    const ask = await setUp();
    expect(await ask("closed", ...words)).toEqual(await ask("bundle", ...words));
  },
  600_000,
);

test.each(["driver", "driver/lib/index.js", "driver/lib/index", "driver/lib"])(
  "where code may come from disk: load %s",
  async name => {
    const ask = await setUp();
    expect(await ask("withCodeFromDisk", "load", name)).toEqual(await ask("run", "load", name));
  },
  600_000,
);

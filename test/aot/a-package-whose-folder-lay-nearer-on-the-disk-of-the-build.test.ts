import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
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

const packageOf = (name: string, version: string, main: string | undefined) => ({
  "package.json": JSON.stringify({ name, version, main }),
  "lib/index.js": `exports.version = ${JSON.stringify(version)};\n`,
});
const driver = (version: string) => packageOf("driver", version, "./lib/index.js");
const below = (folder: string, files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([name, text]) => [`${folder}/${name}`, text]));
const orm = `exports.load = name => require(name);\n`;
const beside = {
  "main.cjs": main,
  "node_modules/dep/index.js": `exports.where = "compiled";\n`,
  "proj/node_modules/dep/index.js": `exports.where = "on disk";\n`,
};

const trees = {
  folders: {
    files: {
      ...beside,
      "node_modules/orm/index.js": orm,
      ...below("node_modules/orm/node_modules/driver", driver("2.0.0")),
      ...below("node_modules/driver", driver("1.0.0")),
      ...below("node_modules/orm/node_modules/JSONDriver", packageOf("JSONDriver", "2.0.0", "./lib/index.js")),
      ...below("node_modules/JSONDriver", packageOf("JSONDriver", "1.0.0", "./lib/index.js")),
      ...below("node_modules/orm/node_modules/@Made/Driver", packageOf("@Made/Driver", "2.0.0", "./lib/index.js")),
      ...below("node_modules/@Made/Driver", packageOf("@Made/Driver", "1.0.0", "./lib/index.js")),
      ...below("node_modules/orm/node_modules/parts", packageOf("parts", "2.0.0", undefined)),
      ...below("node_modules/parts", packageOf("parts", "1.0.0", undefined)),
      "node_modules/orm/node_modules/halves/package.json": JSON.stringify({ name: "halves", version: "2.0.0" }),
      "node_modules/orm/node_modules/halves/lib/other.js": `exports.version = "2.0.0";\n`,
      ...below("node_modules/halves", packageOf("halves", "1.0.0", undefined)),
    },
    links: {},
    entryPoints: ["driver", "JSONDriver", "@Made/Driver", "parts", "halves"],
  },
  store: {
    files: {
      ...beside,
      "node_modules/.store/orm@1/node_modules/orm/index.js": orm,
      ...below("node_modules/.store/driver@2/node_modules/driver", driver("2.0.0")),
      ...below("node_modules/.store/driver@1/node_modules/driver", driver("1.0.0")),
    },
    links: {
      "node_modules/orm": "node_modules/.store/orm@1/node_modules/orm",
      "node_modules/driver": "node_modules/.store/driver@1/node_modules/driver",
      "node_modules/.store/orm@1/node_modules/driver": "node_modules/.store/driver@2/node_modules/driver",
    },
    entryPoints: ["driver"],
  },
};
type Tree = keyof typeof trees;

const forms = { bundle: [], closed: ["--aot"], withCodeFromDisk: ["--aot", "--aot-allow-code-from-disk"] };
type Form = keyof typeof forms | "run" | "closed, started elsewhere";
type Ask = (form: Form, ...words: string[]) => Promise<{ answer?: unknown; threw?: string }>;
const elsewhere = tempDir("aot-a-package-that-lay-nearer-elsewhere", {});
const laid: Disposable[] = [elsewhere];
afterAll(() => laid.forEach(dir => dir[Symbol.dispose]()));
const built: Partial<Record<Tree, Promise<Ask>>> = {};
const setUp = (tree: Tree) =>
  (built[tree] ??= (async () => {
    const dir = tempDir(`aot-a-package-that-lay-nearer-${tree}`, trees[tree].files);
    laid.push(dir);
    const directory = String(dir);
    for (const [from, to] of Object.entries(trees[tree].links)) {
      mkdirSync(dirname(join(directory, from)), { recursive: true });
      symlinkSync(join(directory, to), join(directory, from), "junction");
    }
    for (const [form, flags] of Object.entries(forms)) {
      const outfile = join(directory, "bin", form, nameOfExecutable);
      const entryPoints = ["./main.cjs", ...trees[tree].entryPoints.map(name => `./node_modules/${name}/lib/index.js`)];
      const { stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", ...flags, ...entryPoints, "--outfile", outfile],
        directory,
      );
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    return async (form, ...words) => {
      const isElsewhere = form === "closed, started elsewhere";
      const executable = join(directory, "bin", isElsewhere ? "closed" : form, nameOfExecutable);
      const command = form === "run" ? [bunExe(), "main.cjs"] : [executable];
      const startedIn = isElsewhere ? String(elsewhere) : directory;
      const { stdout, stderr, exitCode } = await run([...command, ...words], startedIn, bunEnv);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout);
    };
  })());

test.each([
  ["folders", "load", "driver"],
  ["folders", "load", "driver/"],
  ["folders", "load", "JSONDriver"],
  ["folders", "load", "@Made/Driver"],
  ["folders", "resolve", "dep"],
  ["store", "load", "driver"],
] as const)(
  "a closed executable, packages in %s: %s %s",
  async (tree, ...words) => {
    const ask = await setUp(tree);
    expect(await ask("closed", ...words)).toEqual(await ask("bundle", ...words));
  },
  600_000,
);

// `bun run` finds the nearer copy's file, which is not in the executable.
test.each(["driver/lib/index.js", "driver/lib/index", "driver/lib", "parts/lib/index.js"])(
  "a closed executable: load %s finds no file of the copy further up",
  async name => {
    const ask = await setUp("folders");
    expect(await ask("run", "load", name)).toEqual({ answer: "2.0.0" });
    expect(await ask("closed", "load", name)).toEqual({ threw: "MODULE_NOT_FOUND" });
    expect(await ask("closed, started elsewhere", "load", name)).toEqual({ threw: "MODULE_NOT_FOUND" });
  },
  600_000,
);

test("a closed executable: a path that the nearer copy lacks is found in the copy further up", async () => {
  const ask = await setUp("folders");
  expect(await ask("run", "load", "halves/lib/index.js")).toEqual({ answer: "1.0.0" });
  expect(await ask("closed", "load", "halves/lib/index.js")).toEqual({ answer: "1.0.0" });
}, 600_000);

test.failing(
  "a closed executable: so it is where the disk does not hold the sources: 1 of 1 is refused, none may",
  async () => {
    const ask = await setUp("folders");
    expect(await ask("closed, started elsewhere", "load", "halves/lib/index.js")).toEqual({ answer: "1.0.0" });
  },
  600_000,
);

test.each([
  ["folders", "driver"],
  ["folders", "driver/lib/index.js"],
  ["folders", "driver/lib/index"],
  ["folders", "driver/lib"],
  ["folders", "JSONDriver"],
  ["folders", "parts/lib/index.js"],
  ["store", "driver"],
] as const)(
  "where code may come from disk, packages in %s: load %s",
  async (tree, name) => {
    const ask = await setUp(tree);
    expect(await ask("withCodeFromDisk", "load", name)).toEqual(await ask("run", "load", name));
  },
  600_000,
);

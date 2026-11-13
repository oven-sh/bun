// A file asks whether it is the program by comparing its own path with process.argv[1].
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const programs: Record<string, { entry: string; files: Record<string, string> }> = {
  "a CommonJS entry point": {
    entry: "bin/cli.cjs",
    files: {
      "bin/cli.cjs": `const fs = require("node:fs"), path = require("node:path"), url = require("node:url");
const [, script] = process.argv;
console.log("argv", process.argv[1] === __filename, __filename == script, script !== __filename, !(__filename != script));
console.log("Bun.main", Bun.main === __filename, Bun.main === process.argv[1]);
console.log("realpath", fs.realpathSync(script) === fs.realpathSync(__filename), fs.realpathSync.native(script) === __filename);
console.log("resolve", path.resolve(script) === __filename, path.join(__dirname, "cli.cjs") === script);
console.log("module", module.filename === __filename, require.main === module);
console.log("main", require.main.filename === __filename, process.mainModule.filename === __filename);
console.log("folder", path.dirname(script) === __dirname, path.dirname(__filename) === path.dirname(Bun.main));
console.log("href", url.pathToFileURL(__filename).href === url.pathToFileURL(script).href, \`\${__filename}\` === script);
const other = require("./other.cjs");
console.log("other", other.isMain(), other.isMain(undefined, __filename + ".other"), other.isSelf);
let mine;
mine = __filename;
if (script === mine && process.argv.length > 1) console.log("condition");
console.log("conditional", script === mine ? "is main" : "is not main", (script !== mine || undefined) ?? "main");
for (let turn = 0; turn < 3 && script === mine; turn++) console.log("turn", turn);
console.log("unlike", __filename === path.join(__dirname, "x"), __filename === "cli.cjs", script === mine + "x", __filename === undefined);
setTimeout(() => console.log("later", process.argv[1] === __filename), 1);
`,
      "bin/other.cjs": `const { fileURLToPath } = require("node:url"), fs = require("node:fs");
const here = typeof document === "undefined" ? new (require("node:url").URL)("file:" + __filename).href : "";
exports.isSelf = [process.argv[1] === __filename, module.filename === __filename, module.parent.filename === __filename].join();
exports.isMain = (file = here, script = process.argv[1]) => {
  if (!file.startsWith("file:")) return "no URL";
  const own = (0, fileURLToPath)(file).replace(/other\\.\\w+$/, "cli");
  const main = fs.realpathSync(script.replace(/\\.other$/, "")).replace(/\\.\\w+$/, "");
  return main === own;
};
`,
    },
  },
  "a library of a command line tool": {
    entry: "build/cli.mjs",
    files: {
      "build/cli.mjs": `import "./cli.cjs";\n`,
      "build/cli.cjs": `const { fileURLToPath } = require("node:url"), fs = require("node:fs");
const here = new (require("node:url").URL)("file:" + __filename).href;
function isMain(url = here, script = process.argv[1]) {
  const own = fileURLToPath(url).replace(/\\.\\w+$/, "");
  const main = fs.realpathSync(script).replace(/\\.\\w+$/, "");
  return main === own;
}
console.log(isMain(), process.argv[1] === __filename);
`,
    },
  },
  "an ES entry point": {
    entry: "cli.ts",
    files: {
      "cli.ts": `export {};
console.log(process.argv[1] === __filename, Bun.main === __filename, import.meta.filename === process.argv[1]);
console.log(Bun.main === import.meta.path, import.meta.dirname === __dirname, import.meta.main);
`,
    },
  },
  "a Worker of the same file": {
    entry: "cli.cjs",
    files: {
      "cli.cjs": `const { Worker, isMainThread, parentPort } = require("node:worker_threads");
const says = () => [process.argv[1] === __filename, Bun.main === __filename, require.main === module].join();
if (isMainThread) {
  console.log("main", says());
  const worker = new Worker(__filename);
  worker.on("message", said => (console.log("worker", said), worker.terminate()));
} else parentPort.postMessage(says());
`,
    },
  },
};

async function run(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, NO_COLOR: "1" });
  return { stdout, stderr, exitCode };
}

async function build(entry: string, app: string, program: string) {
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", program], app);
  expect(built.stderr).not.toMatch(/^error\b/m);
  expect(built.exitCode).toBe(0);
}

test.each(Object.keys(programs))("%s", async title => {
  const { entry, files } = programs[title];
  using dir = tempDir("entry-point-paths", {
    "app/package.json": `{ "name": "app" }`,
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => ["app/" + path, text])),
    "away/empty.txt": "",
  });
  const [app, away] = [join(String(dir), "app"), join(String(dir), "away")];
  const program = join(away, isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), entry], app);
  expect(plain.exitCode).toBe(0);
  await build(entry, app, program);
  renameSync(app, join(String(dir), "gone"));
  expect(await run([program], away)).toEqual(plain);
});

test("both paths stay what they are", async () => {
  using dir = tempDir("entry-point-paths", {
    "app/package.json": `{ "name": "app" }`,
    "app/bin/cli.cjs": `const fs = require("node:fs"), path = require("node:path");
console.log(process.argv[1] === __filename, process.argv[1].length === __filename.length, [__filename].includes(process.argv[1]));
console.log(path.relative("/$bunfs/root", process.argv[1].replaceAll("\\\\", "/").replace("B:/~BUN/root", "/$bunfs/root")));
try {
  console.log("read", fs.readFileSync(path.join(path.dirname(process.argv[1]), "beside.txt"), "utf8"));
} catch (error) {
  console.log(error.code);
}
`,
    "app/bin/beside.txt": "a file of the disk",
  });
  const app = join(String(dir), "app");
  const program = join(app, isWindows ? "program.exe" : "program");
  await build("bin/cli.cjs", app, program);
  const { stdout, stderr, exitCode } = await run([program], app);
  expect(stderr).toBe("");
  expect(stdout).toBe("true false false\ncli.cjs\nENOENT\n");
  expect(exitCode).toBe(0);
});

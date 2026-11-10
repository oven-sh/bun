import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

async function run(cwd: string, cmd: string[], env = bunEnv) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, env);
  return { stdout, stderr, exitCode };
}

function bothWays(dir: string, entryPoint: string, ...flags: string[]) {
  return bothWaysIn(dir, "app", entryPoint, ...flags);
}

/** Builds in `folder`, which is `app` or lies below it. All of `app` is moved away before the executable runs. */
async function bothWaysIn(dir: string, folder: string, entryPoint: string, ...flags: string[]) {
  const cwd = join(dir, folder);
  const plain = await run(cwd, [bunExe(), "run", entryPoint]);
  const built = await run(cwd, [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    entryPoint,
    ...flags,
    "--outfile",
    join(dir, "built.exe"),
  ]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  renameSync(join(dir, "app"), join(dir, "moved-away"));
  return { plain, compiled: await run(dir, ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" }) };
}

describe.concurrent("--asset", () => {
  test("an asset in a folder of a folder keeps its path", async () => {
    using dir = tempDir("aot-asset-in-a-folder-of-a-folder", {
      "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
for (const name of ["outer/inner/note.txt", "inner/note.txt", "outer/other.txt"]) console.log(name, fs.existsSync(path.join(__dirname, name)));
console.log(fs.readdirSync(path.join(__dirname, "outer")).join(), fs.readFileSync(path.join(__dirname, "outer", "inner", "note.txt"), "utf8"), fs.readFileSync(path.join(__dirname, "deep", "down", "one.txt"), "utf8"));
`,
      "app/outer/inner/note.txt": "a note",
      "app/deep/down/one.txt": "one file",
    });
    const { plain, compiled } = await bothWays(
      String(dir),
      "./main.cjs",
      "--asset",
      "./outer/inner",
      "--asset",
      "deep/down/one.txt",
    );
    expect(plain).toEqual({
      stdout: "outer/inner/note.txt true\ninner/note.txt false\nouter/other.txt false\ninner a note one file\n",
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an asset beside the entry point leaves the entry point at the root", async () => {
    using dir = tempDir("aot-asset-beside-the-entry-point-itself", {
      "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8"), fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
`,
      "app/public/index.html": "<p>a page</p>",
      "app/data.json": "{}",
    });
    const { plain, compiled } = await bothWays(
      String(dir),
      "./main.cjs",
      "--asset",
      "./public",
      "--asset",
      "./data.json",
    );
    expect(plain).toEqual({ stdout: "app <p>a page</p> {}\n", stderr: "", exitCode: 0 });
    // `__dirname` is the folder of the build, as with `bun build --compile`. That folder is gone, and the executable answers for what it holds of it.
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an asset beside the folder of the entry point is beside it in the executable", async () => {
    using dir = tempDir("aot-asset-beside-the-entry-point", {
      "app/dist/server/entry.mjs": `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { name } from "./chunks/part.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
console.log(path.basename(here), name, import.meta.dir === here, path.basename(process.argv[1]), Bun.main === fileURLToPath(import.meta.url));
console.log(fs.readFileSync(path.join(here, "..", "client", "index.html"), "utf8"), fs.readdirSync(path.join(here, "..")).sort().join());
`,
      "app/dist/server/chunks/part.mjs": `export const name = "a part";\n`,
      "app/dist/client/index.html": "<p>a page</p>",
    });
    const { plain, compiled } = await bothWays(String(dir), "./dist/server/entry.mjs", "--asset", "dist/client");
    expect(plain).toEqual({
      stdout: "server a part true entry.mjs true\n<p>a page</p> client,server\n",
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("the folder of the entry point itself is an asset", async () => {
    using dir = tempDir("aot-asset-holds-the-entry-point", {
      "app/server/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), fs.readFileSync(__filename, "utf8").split("\\n")[0], fs.readFileSync(path.join(__dirname, "note.txt"), "utf8"), fs.readdirSync(__dirname).sort().join());
`,
      "app/server/note.txt": "a note",
    });
    const { plain, compiled } = await bothWays(String(dir), "./server/start.cjs", "--asset", "server");
    expect(plain).toEqual({
      stdout: `server const fs = require("node:fs"); a note note.txt,start.cjs\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("only an asset at the top has to differ from the name of the executable", async () => {
    using dir = tempDir("aot-asset-named-like-the-executable", {
      "app/main.cjs": `console.log(require("node:fs").readFileSync(require("node:path").join(__dirname, "outer", "built.exe", "note.txt"), "utf8"));\n`,
      "app/outer/built.exe/note.txt": "a note",
      "app/built.exe/note.txt": "another",
    });
    const refused = await run(join(String(dir), "app"), [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "./main.cjs",
      "--asset",
      "./built.exe",
      "--outfile",
      "../built.exe",
    ]);
    expect({
      stderr: refused.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: refused.exitCode,
    }).toEqual({
      stderr: [`error: asset "./built.exe" would embed at the same path as the entry point; use a different outfile`],
      exitCode: 1,
    });
    const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "./outer/built.exe");
    expect(plain).toEqual({ stdout: "a note\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("--root decides what the paths start from", async () => {
    using dir = tempDir("aot-asset-under-a-written-root", {
      "app/packages/site/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), path.basename(path.dirname(__dirname)), fs.readFileSync(path.join(__dirname, "..", "..", "shared", "data", "note.txt"), "utf8"));
`,
      "app/shared/data/note.txt": "a note",
    });
    const { plain, compiled } = await bothWays(
      String(dir),
      "./packages/site/main.cjs",
      "--root",
      ".",
      "--asset",
      "shared/data",
    );
    expect(plain).toEqual({ stdout: "site packages a note\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an asset from outside of the working directory lies beside the entry point by its name", async () => {
    using dir = tempDir("aot-asset-from-elsewhere", {
      "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(fs.existsSync(path.join(__dirname, "..", "elsewhere", "note.txt")), fs.existsSync(path.join(__dirname, "elsewhere", "note.txt")));
`,
      "elsewhere/note.txt": "a note",
    });
    const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "../elsewhere");
    expect(plain).toEqual({ stdout: "true false\n", stderr: "", exitCode: 0 });
    // The first is the file on disk, beside the folder of the build, which `__dirname` names. The second is the one in the executable.
    expect(compiled).toEqual({ ...plain, stdout: "true true\n" });
  }, 120_000);

  test.each(["main.mjs", "main.cjs"])(
    "an outside asset is also found by its base name from %s",
    async entryPoint => {
      const body = `const at = (...names) => fs.existsSync(path.join(here, ...names));
console.log(at("data.txt"), at("elsewhere"), at("elsewhere", "sub", "note.txt"), at("sub"), at("note.txt"));
if (at("elsewhere")) console.log(fs.readdirSync(path.join(here, "elsewhere")).join(), fs.readFileSync(path.join(here, "elsewhere", "sub", "note.txt"), "utf8"));
`;
      using dir = tempDir("aot-outside-asset-base-names", {
        "app/server/main.mjs": `import fs from "node:fs";\nimport path from "node:path";\nconst here = import.meta.dirname;\n${body}`,
        "app/server/main.cjs": `const fs = require("node:fs");\nconst path = require("node:path");\nconst here = __dirname;\n${body}`,
        "app/lib/data.txt": "the text",
        "app/elsewhere/sub/note.txt": "a note",
      });
      const flags = ["--asset", "../lib/data.txt", "--asset", "../elsewhere"];
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", `./${entryPoint}`, ...flags);
      expect(plain).toEqual({ stdout: "false false false false false\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual({ ...plain, stdout: "true true true false false\nsub a note\n" });
    },
    120_000,
  );

  test.each(["main.mjs", "main.cjs"])(
    "an outside asset is mounted outside the root of %s",
    async entryPoint => {
      const body = `console.log(fs.readdirSync(here).sort().join(), fs.readFileSync(path.join(here, "..", "data.txt"), "utf8"));\n`;
      using dir = tempDir("aot-outside-asset-mount", {
        "app/server/main.mjs": `import fs from "node:fs";\nimport path from "node:path";\nconst here = import.meta.dirname;\n${body}`,
        "app/server/main.cjs": `const fs = require("node:fs");\nconst path = require("node:path");\nconst here = __dirname;\n${body}`,
        "app/data.txt": "the text",
      });
      const { plain, compiled } = await bothWaysIn(
        String(dir),
        "app/server",
        `./${entryPoint}`,
        "--asset",
        "../data.txt",
      );
      expect(plain).toEqual({ stdout: "main.cjs,main.mjs the text\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual({ ...plain, stdout: `${entryPoint} the text\n` });
    },
    120_000,
  );

  test("outside folders may share a base name", async () => {
    using dir = tempDir("aot-outside-folders-share-base-name", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const at = (...names) => fs.existsSync(path.join(import.meta.dirname, ...names));
console.log(at("..", "one", "pub", "a.txt"), at("..", "two", "pub", "b.txt"), at("pub", "a.txt"), at("pub", "b.txt"), at("pub", "c.txt"));
`,
      "app/one/pub/a.txt": "a",
      "app/two/pub/b.txt": "b",
    });
    const flags = ["--asset", "../one/pub", "--asset", "../two/pub"];
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect(plain).toEqual({ stdout: "true true false false false\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual({ ...plain, stdout: "true true true true false\n" });
  }, 120_000);

  test("an untidy path finds an embedded file", async () => {
    // Windows drops `absent/..` from a path before it looks, so plain Bun finds these three there.
    const climbsOutOfNoFolder = ["/absent/../sub/note.txt", "/../absent/../lib/data.txt", "/sub/note.txt/../note.txt"];
    const notFound = isWindows ? [] : climbsOutOfNoFolder;
    using dir = tempDir("aot-untidy-embedded-paths", {
      "app/server/main.mjs": `import fs from "node:fs";
const texts = ["/../lib/data.txt", "/../lib/./data.txt", "/../lib//data.txt", "/./sub/note.txt", "/sub/../sub/note.txt"];
for (const text of texts) console.log(text, fs.existsSync(import.meta.dirname + text), fs.readFileSync(import.meta.dirname + text, "utf8"));
for (const text of ${JSON.stringify(notFound)}) console.log(text, fs.existsSync(import.meta.dirname + text));
`,
      "app/server/sub/note.txt": "a note",
      "app/lib/data.txt": "the text",
    });
    const flags = ["--asset", "../lib/data.txt", "--asset", "sub/note.txt"];
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect(plain).toEqual({
      stdout: `/../lib/data.txt true the text
/../lib/./data.txt true the text
/../lib//data.txt true the text
/./sub/note.txt true a note
/sub/../sub/note.txt true a note
${notFound.map(text => text + " false\n").join("")}`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.each([
    [`"../server/note.txt"`, `"../server"`],
    [`"..", "server", "note.txt"`, `"..", "server"`],
  ])(
    "a module above the root reads below it by path.join(here, %s)",
    async (file, folder) => {
      using dir = tempDir("aot-back-through-root-folders", {
        "app/server/main.mjs": `import "../lib/load.mjs";\n`,
        "app/server/note.txt": "a note",
        "app/lib/load.mjs": `import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname;
const [file, folder] = [path.join(here, ${file}), path.join(here, ${folder})];
console.log(fs.existsSync(file), fs.readFileSync(file, "utf8"), fs.existsSync(folder), fs.statSync(folder).isDirectory());
console.log(fs.existsSync(path.join(here, "../servers/note.txt")), fs.existsSync(path.join(here, "../server/absent.txt")));
`,
      });
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "note.txt");
      expect(plain).toEqual({ stdout: "true a note true true\nfalse false\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("an outside folder keeps its path", async () => {
    using dir = tempDir("aot-outside-folder-keeps-path", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dirname, "..", "elsewhere");
console.log(fs.readdirSync(folder).join(), fs.readFileSync(path.join(folder, "sub", "note.txt"), "utf8"));
`,
      "app/elsewhere/sub/note.txt": "a note",
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "../elsewhere");
    expect(plain).toEqual({ stdout: "sub a note\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  // The second embeds the source of the compiled module too.
  test.each([[["--asset", "../lib/data.txt", "--asset", "../lib/sub"]], [["--asset", "../lib"]]])(
    "an asset beside an outside module keeps its path %j",
    async flags => {
      using dir = tempDir("aot-asset-beside-outside-module", {
        "app/server/main.mjs": `import "../lib/load.mjs";\n`,
        "app/lib/load.mjs": `import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname;
console.log(fs.readFileSync(path.join(here, "data.txt"), "utf8"), fs.readFileSync(path.join(here, "sub", "more.txt"), "utf8"));
console.log(fs.existsSync(path.join(here, "sub")), fs.existsSync(path.join(here, "absent.txt")), fs.statSync(path.join(here, "data.txt")).size);
console.log(fs.readdirSync(here).sort().join(), fs.readdirSync(path.join(here, "sub")).join());
`,
        "app/lib/data.txt": "the text",
        "app/lib/sub/more.txt": "more",
      });
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
      expect(plain).toEqual({
        stdout: "the text more\ntrue false 8\ndata.txt,load.mjs,sub more.txt\n",
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("an asset above the working directory keeps its path", async () => {
    using dir = tempDir("aot-asset-above-working-directory", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
console.log(fs.readFileSync(path.join(import.meta.dirname, "..", "data.txt"), "utf8"), fs.readFileSync(new URL("../data.txt", import.meta.url), "utf8"), await Bun.file(new URL("../data.txt", import.meta.url)).exists());
`,
      "app/data.txt": "the text",
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "../data.txt");
    expect(plain).toEqual({ stdout: "the text the text true\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.skipIf(isWindows)(
    "an asset in a linked package keeps its path",
    async () => {
      using dir = tempDir("aot-asset-in-linked-package", {
        "app/server/main.cjs": `console.log(require("pkg").load());\n`,
        "app/pkg/package.json": `{ "name": "pkg", "main": "index.cjs" }`,
        "app/pkg/index.cjs": `exports.load = () => require("node:fs").readFileSync(require("node:path").join(__dirname, "data.txt"), "utf8");\n`,
        "app/pkg/data.txt": "the text",
      });
      mkdirSync(join(String(dir), "app/server/node_modules"));
      symlinkSync("../../pkg", join(String(dir), "app/server/node_modules/pkg"));
      const { plain, compiled } = await bothWaysIn(
        String(dir),
        "app/server",
        "./main.cjs",
        "--asset",
        "../pkg/data.txt",
      );
      expect(plain).toEqual({ stdout: "the text\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("outside assets may share a base name", async () => {
    using dir = tempDir("aot-outside-assets-share-base-name", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const read = (...names) => fs.readFileSync(path.join(import.meta.dirname, ...names), "utf8");
console.log(read("..", "one", "config.json"), read("..", "two", "config.json"), fs.existsSync(path.join(import.meta.dirname, "config.json")));
`,
      "app/one/config.json": "1",
      "app/two/config.json": "2",
    });
    const flags = ["--asset", "../one/config.json", "--asset", "../two/config.json"];
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect(plain).toEqual({ stdout: "1 2 false\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an outside file is also found by its base name", async () => {
    using dir = tempDir("aot-outside-asset-base-name", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
console.log(fs.existsSync(path.join(import.meta.dirname, "data.txt")), Bun.embeddedFiles.map(file => file.name).join());
`,
      "app/lib/data.txt": "the text",
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "../lib/data.txt");
    expect(plain).toEqual({ stdout: "false \n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual({ ...plain, stdout: "true _.._/lib/data.txt\n" });
  }, 120_000);

  // macOS and Windows have no such names.
  test.skipIf(!isLinux).each([[[]], [["--compile-in-place"]]])(
    "an asset whose name is not UTF-8 has U+FFFD in place of each such byte %j",
    async flags => {
      using dir = tempDir("aot-asset-name-is-not-utf-8", {
        "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(fs.readFileSync(path.join(__dirname, "folder\\ufffd", "note.txt"), "utf8"), fs.readFileSync(path.join(__dirname, "file\\ufffd.txt"), "utf8"), fs.readdirSync(__dirname).sort().join());
`,
      });
      const app = join(String(dir), "app");
      const inApp = (before: string, byte: number, behind: string) =>
        Buffer.concat([Buffer.from(join(app, before)), Buffer.from([byte]), Buffer.from(behind)]);
      for (const [byte, text] of [
        [0xff, "a note"],
        [0xfe, "another note"],
      ] as const) {
        mkdirSync(inApp("folder", byte, ""));
        writeFileSync(inApp("folder", byte, "/note.txt"), text);
      }
      writeFileSync(inApp("file", 0xfe, ".txt"), "a file");
      const build = (...assets: string[]) =>
        run(app, [
          "sh",
          "-c",
          `exec "$0" build --compile --aot ./main.cjs "$@" ${assets.map(asset => `--asset "$(printf '${asset}')"`).join(" ")} --outfile ../built.exe`,
          bunExe(),
          ...flags,
        ]);
      const refused = await build("./folder\\377", "./folder\\376");
      expect({
        stderr: refused.stderr.split("\n").filter(line => line.startsWith("error")),
        exitCode: refused.exitCode,
      }).toEqual({
        stderr: [
          expect.stringMatching(/^error: asset .* collides with another embedded file at ".*folder\ufffd\/note\.txt"$/),
        ],
        exitCode: 1,
      });
      const built = await build("./folder\\377", "./file\\376.txt");
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      renameSync(app, join(String(dir), "moved-away"));
      expect(await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({
        stdout: "a note a file file\ufffd.txt,folder\ufffd,main.cjs\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});

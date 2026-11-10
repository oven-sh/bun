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
  const compiled = await run(dir, ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  return { plain, built, compiled };
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

  test.skipIf(isWindows)(
    "opened asset matches lstat",
    async () => {
      using dir = tempDir("aot-opened-asset-matches-lstat", {
        "app/main.cjs": `const fs = require("node:fs");
const { join } = require("node:path");
const at = path => join(__dirname, path);
const same = (a, b) => [a.dev === b.dev, a.ino === b.ino, a.mode === b.mode, a.mtimeNs === b.mtimeNs, a.nlink === b.nlink, a.isFile() === b.isFile()].join();
const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = fs.constants;
const big = { bigint: true };
const said = read => { try { return String(read()); } catch (error) { return error.code; } };
for (const [path, flags] of [["data/note.txt", O_RDONLY | O_NOFOLLOW], ["one.txt", O_RDONLY], ["data/deep/empty.txt", O_RDONLY], ["data", O_RDONLY | O_DIRECTORY], ["data/deep", O_RDONLY]]) {
  const before = fs.lstatSync(at(path), big);
  const fd = fs.openSync(at(path), flags);
  const opened = fs.fstatSync(fd, big);
  fs.closeSync(fd);
  console.log(path, same(before, opened), same(opened, fs.lstatSync(at(path), big)), before.dev > 0n, before.ino > 0n, before.nlink > 0n, before.mtimeNs > 0n);
}
console.log(new Set(["data/note.txt", "one.txt", "data/deep/empty.txt", "data", "data/deep"].map(path => fs.lstatSync(at(path)).ino)).size);
console.log(said(() => fs.openSync(at("one.txt"), O_RDONLY | O_DIRECTORY)), said(() => fs.openSync(at("data/nothing"), "r")));
(async () => {
  const handle = await fs.promises.open(at("data/note.txt"));
  console.log(same(await handle.stat(big), await fs.promises.lstat(at("data/note.txt"), big)), await handle.readFile("utf8"));
  await handle.close();
})();
`,
        "app/data/note.txt": "a note",
        "app/data/deep/empty.txt": "",
        "app/one.txt": "one file",
      });
      const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "data", "--asset", "one.txt");
      const all = "true,true,true,true,true,true";
      const line = (path: string) => `${path} ${all} ${all} true true true true\n`;
      expect(plain).toEqual({
        stdout: `${["data/note.txt", "one.txt", "data/deep/empty.txt", "data", "data/deep"].map(line).join("")}5\nENOTDIR ENOENT\n${all} a note\n`,
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test.skipIf(!isLinux)(
    "reused descriptor reports its file",
    async () => {
      using dir = tempDir("aot-reused-asset-descriptor", {
        "app/main.cjs": `const fs = require("node:fs");
const { join } = require("node:path");
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.mtimeMs === b.mtimeMs && a.size === b.size;
const asset = join(__dirname, "data", "note.txt");
let usedAgain = 0, wrong = 0;
for (let i = 0; i < 40; i++) {
  const path = i % 2 ? asset : join(asset, "..");
  const fd = fs.openSync(path, "r");
  if (!same({ ...fs.fstatSync(fd), size: 0 }, { ...fs.lstatSync(path), size: 0 })) wrong++;
  const held = [];
  do held.push(fs.openSync("/dev/null", "r")); while (held.at(-1) < fd);
  fs.closeSync(fd);
  const real = i % 3 ? process.cwd() : process.execPath;
  const next = fs.openSync(real, "r");
  if (next === fd) usedAgain++;
  if (!same(fs.fstatSync(next), fs.statSync(real))) wrong++;
  for (const each of [next, ...held]) fs.closeSync(each);
}
console.log(usedAgain, wrong);
`,
        "app/data/note.txt": "a note",
      });
      const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "data");
      expect(plain).toEqual({ stdout: "40 0\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "descriptor changes show at once",
    async () => {
      using dir = tempDir("aot-asset-descriptor-changes", {
        "app/main.cjs": `const fs = require("node:fs");
const { join } = require("node:path");
const asset = join(__dirname, "data", "note.txt");
const isSameFile = fd => { const [a, b] = [fs.fstatSync(fd), fs.lstatSync(asset)]; return a.dev === b.dev && a.ino === b.ino && a.nlink === b.nlink; };
for (let i = 0; i < 20; i++) {
  const fd = fs.openSync(asset, "r");
  const before = fs.fstatSync(fd);
  fs.futimesSync(fd, 1000 + i, 2000 + i);
  const timed = fs.fstatSync(fd);
  fs.fchmodSync(fd, 0o640);
  const moded = fs.fstatSync(fd);
  console.log(timed.atimeMs, timed.mtimeMs, timed.mode === before.mode, timed.size, (moded.mode & 0o777).toString(8), moded.mtimeMs, isSameFile(fd));
  fs.fchmodSync(fd, before.mode & 0o777);
  fs.closeSync(fd);
}
`,
        "app/data/note.txt": "a note",
      });
      const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "data");
      const line = (i: number) => `${(1000 + i) * 1000} ${(2000 + i) * 1000} true 6 640 ${(2000 + i) * 1000} true\n`;
      expect(plain).toEqual({
        stdout: Array.from({ length: 20 }, (_, i) => line(i)).join(""),
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

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
      expect(compiled).toEqual({ ...plain, stdout: `data.txt,${entryPoint} the text\n` });
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

  test("a shared base name lists every folder", async () => {
    using dir = tempDir("aot-shared-base-name-lists-all", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const attempt = run => {
  try {
    return run().sort().join();
  } catch (error) {
    return error.code;
  }
};
const at = (...names) => path.join(import.meta.dirname, ...names);
for (const folder of [at("pub"), at("pub", "deep"), at("..", "one", "pub"), at("..", "two", "pub")]) {
  console.log(attempt(() => fs.readdirSync(folder)));
}
console.log(attempt(() => (fs.existsSync(at("pub")) ? [...new Bun.Glob("*.txt").scanSync({ cwd: at("pub") })] : [])));
`,
      "app/one/pub/a.txt": "a",
      "app/one/pub/deep/c.txt": "c",
      "app/two/pub/b.txt": "b",
      "app/two/pub/deep/d.txt": "d",
    });
    const flags = ["--asset", "../one/pub", "--asset", "../two/pub"];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect(built.stdout + built.stderr).not.toContain("share the path");
    const byOwnPlace = "a.txt,deep\nb.txt,deep\n";
    expect(plain).toEqual({ stdout: `ENOENT\nENOENT\n${byOwnPlace}\n`, stderr: "", exitCode: 0 });
    expect(compiled).toEqual({
      ...plain,
      stdout: `a.txt,b.txt,deep\nc.txt,d.txt\n${byOwnPlace}a.txt,b.txt\n`,
    });
  }, 120_000);

  test("a file name in two folders of one base name is warned of", async () => {
    using dir = tempDir("aot-asset-name-in-two-folders", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const read = (...names) => {
  try {
    return fs.readFileSync(path.join(import.meta.dirname, ...names), "utf8");
  } catch (error) {
    return error.code;
  }
};
console.log(read("..", "one", "pub", "same.txt"), read("..", "two", "pub", "same.txt"), read("..", "two", "pub", "only.txt"));
console.log(read("pub", "same.txt"), read("pub", "only.txt"));
`,
      "app/one/pub/same.txt": "of-one",
      "app/two/pub/same.txt": "of-two",
      "app/two/pub/only.txt": "only-in-two",
    });
    const flags = ["--asset", "../one/pub", "--asset", "../two/pub"];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect((built.stdout + built.stderr).split("\n").filter(line => line.includes("share the path"))).toEqual([
      `warn: assets "../one/pub/same.txt" and "../two/pub/same.txt" share the path "pub/same.txt" in the executable. That path reads "../one/pub/same.txt". Each asset is also at its own path`,
    ]);
    expect(plain).toEqual({ stdout: "of-one of-two only-in-two\nENOENT ENOENT\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual({ stdout: "of-one of-two only-in-two\nof-one only-in-two\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test("an asset that import.meta cannot reach is warned of", async () => {
    const say = `const say = (label, at) => {
  try {
    console.log(label, fs.readFileSync(at, "utf8"));
  } catch (error) {
    console.log(label, error.code);
  }
};`;
    const head = `import fs from "node:fs";\nimport path from "node:path";\n${say}`;
    using dir = tempDir("aot-asset-out-of-reach", {
      "app/middle/server/main.mjs": `${head}
import "./sub/below.mjs";
import "./build-path.mjs";
import "./own-dirname.mjs";
import "../beside/above.mjs";
import { createRequire } from "node:module";
say("entry", path.join(import.meta.dirname, "..", "..", "far", "a.txt"));
say("one folder up", path.join(import.meta.dirname, "..", "near", "b.txt"));
createRequire(import.meta.url)("./common.cjs");
`,
      "app/middle/server/sub/below.mjs": `${head}
say("below the root", path.join(import.meta.dirname, "..", "..", "..", "far", "a.txt"));
`,
      "app/middle/server/build-path.mjs": `${head}
say("__dirname", path.join(__dirname, "..", "..", "far", "a.txt"));
`,
      "app/middle/server/own-dirname.mjs": `${head}
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
say("a __dirname of its own", path.join(__dirname, "..", "..", "far", "a.txt"));
`,
      "app/middle/beside/above.mjs": `${head}
say("above the root", path.join(import.meta.dirname, "..", "..", "far", "a.txt"));
`,
      "app/middle/server/common.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
say("CommonJS", path.join(__dirname, "..", "..", "far", "a.txt"));
`,
      "app/far/a.txt": "far",
      "app/middle/near/b.txt": "near",
    });
    const flags = ["--asset", "../../far", "--asset", "../near"];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/middle/server", "./main.mjs", ...flags);
    const imported = ["below the root", "__dirname", "a __dirname of its own", "above the root"];
    const order = [...imported, "entry", "one folder up", "CommonJS"];
    const text = (label: string) => (label === "one folder up" ? "near" : "far");
    expect(plain.stdout).toBe(order.map(label => `${label} ${text(label)}\n`).join(""));
    const isOutOfReach = (label: string) => ["entry", "below the root", "a __dirname of its own"].includes(label);
    expect(compiled).toEqual({
      stdout: order.map(label => `${label} ${isOutOfReach(label) ? "ENOENT" : text(label)}\n`).join(""),
      stderr: "",
      exitCode: 0,
    });
    const output = (built.stdout + built.stderr).replaceAll("\\", "/");
    const warned = [...output.matchAll(/TS100087[^\n]*\n[^\n]*?at ([^\n:]+):(\d+)/g)].map(it => `${it[1]}:${it[2]}`);
    expect({ warnings: output.split("TS100087").length - 1, others: output.split("TS100098").length - 1 }).toEqual({
      warnings: 3,
      others: 0,
    });
    expect(output).toContain(
      `This reads "../../far/a.txt", which is in the executable, but this path doesn't lead there`,
    );
    expect(warned.length === 0 || warned.every(it => /main\.mjs|below\.mjs|own-dirname\.mjs/.test(it))).toBe(true);
  }, 120_000);

  test.skipIf(isWindows)(
    "the written path decides whether import.meta reaches an asset",
    async () => {
      using dir = tempDir("aot-asset-reach-through-links", {
        "app/middle/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const say = (label, ask) => {
  try {
    console.log(label, String(ask()));
  } catch (error) {
    console.log(label, error.code);
  }
};
say("a link one up", () => fs.readFileSync(path.join(import.meta.dirname, "..", "near-link", "a.txt"), "utf8"));
say("a link two up", () => fs.readFileSync(path.join(import.meta.dirname, "..", "..", "far-link", "b.txt"), "utf8"));
say("a folder two up", () => fs.existsSync(path.join(import.meta.dirname, "..", "..", "far")));
say("its listing", () => fs.readdirSync(path.join(import.meta.dirname, "..", "..", "far")));
`,
        "app/far/a.txt": "far",
        "app/middle/near/b.txt": "near",
      });
      symlinkSync("../far", join(String(dir), "app/middle/near-link"));
      symlinkSync("middle/near", join(String(dir), "app/far-link"));
      const flags = ["../near-link", "../../far-link", "../../far"].flatMap(asset => ["--asset", asset]);
      const { plain, built, compiled } = await bothWaysIn(String(dir), "app/middle/server", "./main.mjs", ...flags);
      expect(plain.stdout).toBe("a link one up far\na link two up near\na folder two up true\nits listing a.txt\n");
      expect(compiled).toEqual({
        stdout: "a link one up far\na link two up ENOENT\na folder two up false\nits listing ENOENT\n",
        stderr: "",
        exitCode: 0,
      });
      const output = built.stdout + built.stderr;
      const warned = [...output.matchAll(/TS100087: This reads "([^"]+)"/g)].map(it => it[1]).sort();
      // A gap: the build follows no listing, so "../../far" stands here once, for existsSync(), and not twice.
      expect(warned).toEqual(["../../far", "../../far-link/b.txt"]);
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "a read through a link inside an asset folder is warned of",
    async () => {
      const files = {
        "app/middle/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname;
const say = (label, read) => {
  try {
    console.log(label, read());
  } catch (error) {
    console.log(label, error.code);
  }
};
say("through a folder link", () => fs.readFileSync(path.join(here, "..", "box", "inner", "a.txt"), "utf8"));
say("through a file link", () => fs.readFileSync(path.join(here, "..", "box", "file-link.txt"), "utf8"));
say("beside them", () => fs.readFileSync(path.join(here, "..", "box", "own.txt"), "utf8"));
say("below the root", () => fs.readFileSync(path.join(here, "held", "inner", "a.txt"), "utf8"));
`,
        "app/far/a.txt": "far",
        "app/middle/box/own.txt": "own",
        "app/middle/server/held/own.txt": "own",
      };
      const links = (dir: string) => {
        symlinkSync("../../far", join(dir, "app/middle/box/inner"));
        symlinkSync("../../far/a.txt", join(dir, "app/middle/box/file-link.txt"));
        symlinkSync("../../../far", join(dir, "app/middle/server/held/inner"));
      };
      const asked = "through a folder link far\nthrough a file link far\nbeside them own\nbelow the root far\n";
      const given = ["--asset", "../box", "--asset", "held"];
      let advised: string[];
      {
        using dir = tempDir("aot-links-inside-assets", files);
        links(String(dir));
        const { plain, built, compiled } = await bothWaysIn(String(dir), "app/middle/server", "./main.mjs", ...given);
        expect(plain.stdout).toBe(asked);
        expect(compiled.stdout).toBe(
          "through a folder link ENOENT\nthrough a file link ENOENT\nbeside them own\nbelow the root ENOENT\n",
        );
        const warnings = /(TS\d+): This reads "([^"]+)"[^\n]*? Embed it with --asset (\S+)/g;
        const found = [...(built.stdout + built.stderr).matchAll(warnings)];
        expect(found.map(it => `${it[1]} ${it[2]} > ${it[3]}`).sort()).toEqual([
          "TS100165 ../box/file-link.txt > ../box/file-link.txt",
          "TS100165 ../box/inner/a.txt > ../box/inner",
          "TS100165 held/inner/a.txt > held/inner",
        ]);
        advised = found.map(it => it[3]);
      }
      {
        // What the messages advise, word for word.
        using dir = tempDir("aot-links-given-as-assets", files);
        links(String(dir));
        const flags = [...given, ...advised.flatMap(asset => ["--asset", asset])];
        const { built, compiled } = await bothWaysIn(String(dir), "app/middle/server", "./main.mjs", ...flags);
        expect(compiled.stdout).toBe(asked);
        expect(built.stdout + built.stderr).not.toContain("This reads");
      }
    },
    240_000,
  );

  test("an outside folder without files gets no name in the root", async () => {
    using dir = tempDir("aot-outside-folder-without-files", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
console.log(fs.readdirSync(import.meta.dirname).join(), fs.existsSync(path.join(import.meta.dirname, "empty")));
`,
    });
    mkdirSync(join(String(dir), "app/empty"));
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "../empty");
    expect(plain).toEqual({ stdout: "main.mjs false\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.each(["mjs", "cjs"] as const)(
    "in %s a folder below the root shares its base name with one outside",
    async kind => {
      const head =
        kind === "mjs"
          ? `import fs from "node:fs"; import path from "node:path"; const here = import.meta.dirname;`
          : `const fs = require("node:fs"), path = require("node:path"), here = __dirname;`;
      using dir = tempDir("aot-own-folder-shares-base-name", {
        [`app/server/main.${kind}`]: `${head}
const read = (...names) => {
  try {
    return fs.readFileSync(path.join(here, ...names), "utf8");
  } catch (error) {
    return error.code;
  }
};
const tidy = it => it.replaceAll("\\\\", "/");
console.log("own place", read("pub", "in.txt"), read("pub", "same.txt"), read("..", "one", "pub", "out.txt"), read("..", "one", "pub", "same.txt"));
console.log("base name", read("pub", "out.txt"), read("pub", "deep", "far.txt"), read("pub", "absent.txt"));
console.log("outside", fs.readdirSync(path.join(here, "..", "one", "pub")).sort().join());
console.log("listed", fs.readdirSync(path.join(here, "pub")).sort().join());
console.log("below", fs.readdirSync(path.join(here, "pub"), { recursive: true }).map(tidy).sort().join());
console.log("glob", [...new Bun.Glob("pub/**/*.txt").scanSync({ cwd: here })].map(tidy).sort().join());
console.log("embedded", Bun.embeddedFiles.map(it => tidy(it.name)).filter(it => !it.startsWith("main")).sort().join());
`,
        "app/server/pub/in.txt": "in",
        "app/server/pub/same.txt": "own",
        "app/one/pub/out.txt": "out",
        "app/one/pub/same.txt": "outside",
        "app/one/pub/deep/far.txt": "far",
      });
      const flags = ["--asset", "../one/pub", "--asset", "pub"];
      const { plain, built, compiled } = await bothWaysIn(String(dir), "app/server", `./main.${kind}`, ...flags);
      expect((built.stdout + built.stderr).split("\n").filter(line => line.includes("share the path"))).toEqual([
        `warn: assets "pub/same.txt" and "../one/pub/same.txt" share the path "pub/same.txt" in the executable. That path reads "pub/same.txt". Each asset is also at its own path`,
      ]);
      const ownPlace = "own place in own out outside";
      const outside = "outside deep,out.txt,same.txt";
      expect(plain).toEqual({
        stdout: `${ownPlace}
base name ENOENT ENOENT ENOENT
${outside}
listed in.txt,same.txt
below in.txt,same.txt
glob pub/in.txt,pub/same.txt
embedded 
`,
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual({
        stdout: `${ownPlace}
base name out far ENOENT
${outside}
listed deep,in.txt,out.txt,same.txt
below deep,deep/far.txt,in.txt,out.txt,same.txt
glob pub/deep/far.txt,pub/in.txt,pub/out.txt,pub/same.txt
embedded _.._/one/pub/same.txt,pub/deep/far.txt,pub/in.txt,pub/out.txt,pub/same.txt
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each(["mjs", "cjs"] as const)(
    "in %s what the root holds hides an outside entry of its name",
    async kind => {
      const head =
        kind === "mjs"
          ? `import fs from "node:fs"; import path from "node:path"; import "./pub/code.mjs"; const here = import.meta.dirname;`
          : `const fs = require("node:fs"), path = require("node:path"), here = __dirname; require("./pub/code.cjs");`;
      using dir = tempDir("aot-own-entries-hide-outside-ones", {
        [`app/server/main.${kind}`]: `${head}
const say = (label, ask) => {
  try {
    console.log(label, String(ask()));
  } catch (error) {
    console.log(label, error.code);
  }
};
const at = (...names) => path.join(here, ...names);
const tidy = it => it.replaceAll("\\\\", "/");
const open = folder => {
  const opened = fs.opendirSync(folder);
  const first = opened.readSync().name;
  opened.closeSync();
  return first;
};
say("as plain: the own folder is one", () => fs.statSync(at("pub", "folder")).isDirectory());
say("as plain: the own folder is read", () => fs.readFileSync(at("pub", "folder"), "utf8"));
say("as plain: the own folder is listed", () => fs.readdirSync(at("pub", "folder")).join());
say("as plain: the own folder is opened", () => open(at("pub", "folder")));
say("as plain: the own file is read", () => fs.readFileSync(at("pub", "file"), "utf8"));
say("as plain: below the own file", () => fs.readFileSync(at("pub", "file", "in.txt"), "utf8"));
say("as plain: the outside file", () => fs.readFileSync(at("..", "one", "pub", "folder"), "utf8"));
say("as plain: the outside folder", () => fs.readFileSync(at("..", "one", "pub", "file", "in.txt"), "utf8"));
say("outside alone", () => fs.readFileSync(at("pub", "only.txt"), "utf8"));
say("listed", () => fs.readdirSync(at("pub")).sort().join());
say("below", () => fs.readdirSync(at("pub"), { recursive: true }).map(tidy).sort().join());
`,
        [`app/server/pub/code.${kind}`]: kind === "mjs" ? "export {};\n" : "exports.loaded = true;\n",
        "app/server/pub/folder/in.txt": "own in",
        "app/server/pub/file": "own file",
        "app/one/pub/folder": "outside file",
        "app/one/pub/file/in.txt": "outside in",
        "app/one/pub/only.txt": "only",
      });
      const flags = ["--asset", "../one/pub", "--asset", "pub"];
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", `./main.${kind}`, ...flags);
      const isAsPlain = (line: string) => line.startsWith("as plain: ");
      const asPlain = plain.stdout.split("\n").filter(isAsPlain);
      expect(asPlain).toHaveLength(8);
      // A gap in CommonJS off Windows: a name below a file of the executable fails with ENOENT where `bun run` says ENOTDIR. The day it says ENOTDIR this fails: take the line out.
      const hasGap = kind === "cjs" && !isWindows;
      const expected = asPlain.map(line => (hasGap ? line.replace("own file ENOTDIR", "own file ENOENT") : line));
      expect(compiled.stdout.split("\n").filter(isAsPlain)).toEqual(expected);
      const rest = compiled.stdout.split("\n").filter(line => !isAsPlain(line));
      expect({ ...compiled, stdout: rest.join("\n") }).toEqual({
        stdout: `outside alone only
listed code.${kind},file,folder,only.txt
below code.${kind},file,folder,folder/in.txt,only.txt
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each([
    ["the file", ["../one/pub", "../two/pub"], "file of one", "no file", "only.txt,x", "only.txt,x"],
    ["the folder", ["../two/pub", "../one/pub"], "EISDIR", "in two", "only.txt,x", "only.txt,x,x/in.txt"],
  ] as const)(
    "of two outside folders the earlier one decides: %s",
    async (_, assets, entry, below, listed, listedBelow) => {
      using dir = tempDir("aot-earlier-folder-hides-later-one", {
        "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const say = (label, ask) => {
  try {
    console.log(label, String(ask()));
  } catch (error) {
    console.log(label, error.code === "ENOTDIR" || error.code === "ENOENT" ? "no file" : error.code);
  }
};
const at = (...names) => path.join(import.meta.dirname, "pub", ...names);
say("entry", () => fs.readFileSync(at("x"), "utf8"));
say("below", () => fs.readFileSync(at("x", "in.txt"), "utf8"));
say("is a folder", () => fs.statSync(at("x")).isDirectory());
say("listed", () => fs.readdirSync(at()).sort().join());
say("listed below", () => fs.readdirSync(at(), { recursive: true }).map(it => it.replaceAll("\\\\", "/")).sort().join());
`,
        "app/one/pub/x": "file of one",
        "app/one/pub/only.txt": "only",
        "app/two/pub/x/in.txt": "in two",
      });
      const flags = assets.flatMap(asset => ["--asset", asset]);
      const { compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
      expect(compiled).toEqual({
        stdout: `entry ${entry}
below ${below}
is a folder ${entry === "EISDIR"}
listed ${listed}
listed below ${listedBelow}
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each([
    ["a file", { "app/zero/pub/x": "file" }, "x/same.txt", "pub/x/same.txt", "no file"],
    ["a folder", { "app/zero/pub/x/in.txt": "in" }, "x", "pub/x", "EISDIR"],
    ["nothing", { "app/zero/pub/other.txt": "other" }, "x", "pub/x", "of one"],
  ] as const)(
    "the warning on a shared path says what the path reads where %s comes first",
    async (_, earlier, shared, name, read) => {
      using dir = tempDir("aot-shared-path-behind-earlier-entry", {
        "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
try {
  console.log(fs.readFileSync(path.join(import.meta.dirname, ${JSON.stringify(name)}), "utf8"));
} catch (error) {
  console.log(error.code === "ENOTDIR" || error.code === "ENOENT" ? "no file" : error.code);
}
`,
        ...earlier,
        [`app/one/pub/${shared}`]: "of one",
        [`app/two/pub/${shared}`]: "of two",
      });
      const flags = ["zero", "one", "two"].flatMap(folder => ["--asset", `../${folder}/pub`]);
      const { built, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
      expect(compiled).toEqual({ stdout: `${read}\n`, stderr: "", exitCode: 0 });
      const sentence = read === "of one" ? `"../one/${name}"` : `none of them: "../zero/pub/x" comes first`;
      expect((built.stdout + built.stderr).replaceAll("\\", "/")).toContain(
        `assets "../one/${name}" and "../two/${name}" share the path "${name}" in the executable. That path reads ${sentence}. Each`,
      );
    },
    120_000,
  );

  const namedAtRoot = [
    ["a folder", ["--asset", "../lib/pub"], "pub", "pub/a.txt", "../lib", ["pub/a.txt", "pub/deep/c.txt"]],
    ["a file", ["--asset", "../lib/note.txt"], "note.txt", "note.txt", "../lib", ["note.txt"]],
    [
      "two folders",
      ["--asset", "../lib/pub", "--asset", "../more/pub"],
      "pub",
      "pub/b.txt",
      "../more",
      ["pub/a.txt", "pub/b.txt", "pub/deep/c.txt"],
    ],
  ] as const;
  test.each(namedAtRoot.flatMap(row => (["mjs", "cjs"] as const).map(kind => [kind, ...row] as const)))(
    "in %s the base name of %s from outside answers as a path does",
    async (kind, _, flags, top, file, place, all) => {
      const head =
        kind === "mjs"
          ? `import fs from "node:fs"; import path from "node:path"; const here = import.meta.dirname;`
          : `const fs = require("node:fs"), path = require("node:path"), here = __dirname;`;
      using dir = tempDir("aot-base-names-at-root", {
        [`app/server/main.${kind}`]: `${head}
const tidy = it => it.replaceAll("\\\\", "/");
const isFile = at => {
  try {
    return fs.statSync(at, { throwIfNoEntry: false })?.isFile() ?? null;
  } catch (error) {
    return error.code;
  }
};
const ask = async at => [fs.existsSync(at), isFile(at), await Bun.file(at).exists()];
const spell = names => {
  const file = path.join(here, ...names), folder = path.dirname(file), base = path.basename(file);
  return {
    tidy: file,
    untidy: folder + "/./" + base,
    doubled: folder + "//" + base,
    slash: file + "/",
    separator: file + path.sep,
    backslash: file + "\\\\",
    climbs: file + "/../" + base,
    backslashes: here + "\\\\" + names.join("\\\\"),
    forward: tidy(file),
    lower: file[0].toLowerCase() + file.slice(1),
    upper: file[0].toUpperCase() + file.slice(1),
  };
};
(async () => {
  const names = ${JSON.stringify(file.split("/"))};
  for (const [way, from] of [["short", []], ["own", ${JSON.stringify(place.split("/"))}]])
    for (const [name, at] of Object.entries(spell([...from, ...names]))) console.log(way, name, JSON.stringify(await ask(at)));
  console.log("embedded", Bun.embeddedFiles.map(it => tidy(it.name)).filter(it => !it.startsWith("main")).sort().join());
  console.log("root", fs.readdirSync(here).sort().join());
  console.log("glob", [...new Bun.Glob("**/*.txt").scanSync({ cwd: here })].map(tidy).sort().join());
  console.log("globSync", fs.globSync("**/*.txt", { cwd: here }).map(tidy).sort().join());
})();
`,
        "app/lib/pub/a.txt": "a",
        "app/lib/pub/deep/c.txt": "c",
        "app/lib/note.txt": "n",
        "app/more/pub/b.txt": "b",
      });
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", `./main.${kind}`, ...flags);
      const linesOf = (ran: typeof plain) => ran.stdout.split("\n");
      const rowsOf = (ran: typeof plain, way: string) =>
        linesOf(ran)
          .filter(line => line.startsWith(way + " "))
          .map(line => line.slice(way.length + 1));
      // The platform decides what an untidy spelling names. Under plain Bun the asset lies at its own place alone: what is said of it there, the executable says by either name.
      const asPlain = rowsOf(plain, "own");
      const found = "[true,true,true]";
      const absent = "[false,null,false]";
      const noFolder = '[false,"ENOTDIR",false]';
      const onPosix = {
        tidy: found,
        untidy: found,
        doubled: found,
        slash: noFolder,
        separator: noFolder,
        backslash: absent,
      };
      const alsoOnPosix = { climbs: noFolder, backslashes: absent, forward: found, lower: found, upper: found };
      const said = Object.entries({ ...onPosix, ...alsoOnPosix }).map(([name, answer]) => `${name} ${answer}`);
      expect(isWindows ? asPlain.slice(0, 1) : asPlain).toEqual(isWindows ? said.slice(0, 1) : said);
      // CI cuts the middle out of a long failure, so only the rows that differ are shown, each with both answers.
      const differing = ["short", "own"].flatMap(way => {
        const rows = rowsOf(compiled, way);
        const missing = rows.length === asPlain.length ? [] : [`${way}: ${rows.length} rows of ${asPlain.length}`];
        return [...missing, ...rows.filter((row, at) => row !== asPlain[at]).map(row => `${way} ${row}`)];
      });
      const differingInPlain = asPlain.filter(row => differing.some(it => it.split(" ")[1] === row.split(" ")[0]));
      expect({ executable: differing, plain: differingInPlain }).toEqual({ executable: [], plain: [] });
      const rest = linesOf(compiled).filter(line => !/^(short|own) /.test(line));
      expect({ ...compiled, stdout: rest.join("\n") }).toEqual({
        stdout: `embedded ${all.join()}
root ${[`main.${kind}`, top].sort().join()}
glob ${all.join()}
globSync ${all.join()}
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "a backslash in an asset's name stays in it",
    async () => {
      using dir = tempDir("aot-backslash-in-asset-names", {
        "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const read = (...names) => {
  try {
    return fs.readFileSync(path.join(import.meta.dirname, ...names), "utf8");
  } catch (error) {
    return error.code;
  }
};
console.log(read("..", "lib", "pub\\\\x", "a.txt"), read("in\\\\y", "b.txt"), read("..", "lib", "f\\\\g.txt"));
console.log(read("pub\\\\x", "a.txt"), read("f\\\\g.txt"), read("pub", "x", "a.txt"), read("in", "y", "b.txt"), read("g.txt"));
console.log(Bun.embeddedFiles.map(it => it.name).filter(it => !it.startsWith("main")).sort().join());
`,
        "app/lib/pub\\x/a.txt": "a",
        "app/server/in\\y/b.txt": "b",
        "app/lib/f\\g.txt": "g",
      });
      const flags = ["--asset", "../lib/pub\\x", "--asset", "in\\y", "--asset", "../lib/f\\g.txt"];
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
      const byOwnPlace = "a b g\n";
      expect(plain).toEqual({ stdout: `${byOwnPlace}ENOENT ENOENT ENOENT ENOENT ENOENT\n\n`, stderr: "", exitCode: 0 });
      expect(compiled).toEqual({
        stdout: `${byOwnPlace}a g ENOENT ENOENT ENOENT\nf\\g.txt,in\\y/b.txt,pub\\x/a.txt\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

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
    expect(compiled).toEqual({ ...plain, stdout: "true data.txt\n" });
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

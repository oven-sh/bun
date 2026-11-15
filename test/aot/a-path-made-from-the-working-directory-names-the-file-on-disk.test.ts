import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, test } from "./harness/default-timeout";
import { run } from "./harness/run";

const nameOfExecutable = isWindows ? "tool.exe" : "tool";

const project = (who: string): Record<string, string> => ({
  "package.json": `{ "name": ${JSON.stringify(who)} }`,
  "settings.toml": `owner = ${JSON.stringify(who)}\n`,
  "notes.txt": who,
  "config.js": `exports.owner = ${JSON.stringify(who)};\n`,
  "node_modules/dock/package.json": `{ "name": "dock", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/dock/index.js": `exports.owner = require("./lib/inner.js").owner;\n`,
  "node_modules/dock/lib/inner.js": `exports.owner = ${JSON.stringify(who)};\n`,
});

const cli = (knowsFolder: boolean) => `
const path = require("node:path");
const fs = require("node:fs");
const text = { with: { type: "text" } };
const there = ${knowsFolder ? `process.argv[3] === "where it was built" ? __dirname : process.cwd()` : `process.cwd()`};
const roads = {
  json: () => [require("./package.json").name, require(there + "/package.json").name],
  toml: async () => [(await import("./settings.toml")).default.owner, (await import(there + "/settings.toml")).default.owner],
  text: async () => [(await import("./notes.txt", text)).default, (await import(there + "/notes.txt", text)).default],
  oneObject: () => require("./package.json") === require(there + "/package.json"),
  required: () => [require("./config.js").owner, require(there + "/config.js").owner],
  imported: async () => [require("./config.js").owner, (await import(require("node:url").pathToFileURL(there + "/config.js").href)).default.owner],
  sameTextOtherImports: () => [require("dock").owner, require(there + "/node_modules/dock/index.js").owner],
  otherExtension: () => [require("./lib.ts").owner, require(there + "/lib.js").owner],
  rewrittenBetweenLoads: () => {
    const first = require(there + "/config.js");
    fs.writeFileSync(there + "/config.js", "exports.owner = 'rewritten';");
    return [first.owner, require(there + "/config.js") === first];
  },
  plugin: () => require(there + "/plugin.cjs"),
};
(async () => {
  try {
    console.log(JSON.stringify({ answer: await roads[process.argv[2]]() }));
  } catch (error) {
    console.log(JSON.stringify({ threw: error.code ?? error.name }));
  }
})();
`;

type Form = "bundle" | "closed" | "withCodeFromDisk" | "knowsFolder" | "rootBelow";
type Said = { answer?: unknown; threw?: string };

const dir = tempDir("aot-path-from-the-working-directory", {});
afterAll(() => dir[Symbol.dispose]());
const directory = String(dir);

const lay = (folder: string, files: Record<string, string>) => {
  mkdirSync(join(directory, folder), { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(join(directory, folder, name, ".."), { recursive: true });
    writeFileSync(join(directory, folder, name), contents);
  }
};

let built: Promise<(form: Form, road: string, cwd: string, from?: string, where?: string) => Promise<Said>> | undefined;
const setUp = () =>
  (built ??= (async () => {
    lay("tool", {
      ...project("the tool"),
      "lib.ts": `export const owner: string = "the tool";\n`,
      "cli.cjs": cli(false),
      "knows-folder.cjs": cli(true),
      "deep/cli.cjs": `console.log(JSON.stringify({ answer: [typeof __dirname, require("../package.json").name, require(process.cwd() + "/package.json").name] }));`,
    });
    const builds: [Form, string[]][] = [
      ["bundle", ["./cli.cjs"]],
      ["closed", ["--aot", "./cli.cjs", "./config.js"]],
      ["withCodeFromDisk", ["--aot", "--aot-allow-code-from-disk", "./cli.cjs"]],
      ["knowsFolder", ["--aot", "--aot-allow-code-from-disk", "./knows-folder.cjs"]],
      ["rootBelow", ["--aot", "./deep/cli.cjs"]],
    ];
    for (const [form, words] of builds) {
      const outfile = join(directory, "bin", form, nameOfExecutable);
      const { stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", ...words, "--outfile", outfile],
        join(directory, "tool"),
      );
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    return async (form, road, cwd, from = "bin", where = "") => {
      const { stdout, stderr, exitCode } = await run(
        [join(directory, from, form, nameOfExecutable), road, where],
        join(directory, cwd),
        bunEnv,
      );
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout);
    };
  })());

const user = () => ({
  ...project("its user"),
  "lib.js": `exports.owner = "its user";\n`,
  "plugin.cjs": `module.exports = [require("dock").owner, require("./config.js").owner];\n`,
});

const timeout = 600_000;
const data = ["json", "toml", "text"];
const code = ["required", "imported", "sameTextOtherImports", "otherExtension"];

test.each([...data, ...code, "plugin"])(
  "in its user's project, with code from disk: %s",
  async road => {
    const ask = await setUp();
    lay("user", user());
    const bundle = await ask("bundle", road, "user");
    expect(JSON.stringify(bundle.answer)).toContain("its user");
    expect(await ask("withCodeFromDisk", road, "user")).toEqual(bundle);
  },
  timeout,
);

test.each(data)(
  "in its user's project, without the flag, data is read: %s",
  async road => {
    const ask = await setUp();
    lay("user", user());
    expect(await ask("closed", road, "user")).toEqual({ answer: ["the tool", "its user"] });
  },
  timeout,
);

test.each(code)(
  "in its user's project, without the flag, code is refused and not replaced: %s",
  async road => {
    const ask = await setUp();
    lay("user", user());
    expect((await ask("closed", road, "user")).threw).toEndWith("MODULE_NOT_FOUND");
  },
  timeout,
);

test.each([...data, "required", "imported"])(
  "where nothing lies there, nothing is found: %s",
  async road => {
    const ask = await setUp();
    lay("empty", {});
    const bundle = await ask("bundle", road, "empty");
    expect(bundle.threw).toBeString();
    expect(await ask("closed", road, "empty")).toEqual(bundle);
    expect(await ask("withCodeFromDisk", road, "empty")).toEqual(bundle);
  },
  timeout,
);

test(
  "a copy of its own project is a project like any other",
  async () => {
    const ask = await setUp();
    cpSync(join(directory, "tool"), join(directory, "moved"), { recursive: true });
    const askAfresh = (form: Form, road: string) => {
      lay("moved", project("the tool"));
      return ask(form, road, "moved");
    };
    for (const road of ["oneObject", "required", "rewrittenBetweenLoads"]) {
      expect(await askAfresh("withCodeFromDisk", road)).toEqual(await askAfresh("bundle", road));
    }
    expect(await askAfresh("closed", "oneObject")).toEqual({ answer: false });
    expect((await askAfresh("closed", "required")).threw).toEndWith("MODULE_NOT_FOUND");
  },
  timeout,
);

test(
  "a project that lies from a copy of the executable as the built one lay",
  async () => {
    const ask = await setUp();
    lay("installed/tool", user());
    lay("elsewhere", {});
    mkdirSync(join(directory, "installed/bin/knowsFolder"), { recursive: true });
    copyFileSync(
      join(directory, "bin/knowsFolder", nameOfExecutable),
      join(directory, "installed/bin/knowsFolder", nameOfExecutable),
    );
    expect(await ask("knowsFolder", "required", "installed/tool", "installed/bin")).toEqual({
      answer: ["the tool", "its user"],
    });
  },
  timeout,
);

test(
  "the path that a compiled file had at the build names it, below the root directory and above it",
  async () => {
    const ask = await setUp();
    lay("elsewhere", {});
    lay("tool", {
      "config.js": `exports.owner = "written behind the build";\n`,
      "package.json": `{ "name": "written behind the build" }`,
    });
    for (const cwd of ["tool", "elsewhere"]) {
      expect(await ask("knowsFolder", "required", cwd, "bin", "where it was built")).toEqual({
        answer: ["the tool", "the tool"],
      });
    }
    expect(await ask("rootBelow", "", "tool")).toEqual({ answer: ["string", "the tool", "the tool"] });
  },
  timeout,
);

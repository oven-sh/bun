// `--compile --target=browser` writes one HTML page when every entry point is an HTML file. Anything else is an executable, as without --aot.
import { expect } from "bun:test";
import { readdirSync, readFileSync, realpathSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { test } from "./supported";

const buildId = /^ +build id  [0-9a-f]{32}$/m;

const program = {
  "second.js": `module.exports = { greeting: "hello from second" };\n`,
  "entry.js": `
    const specifier = "./second" + ".js";
    const second = require(specifier);
    console.log(second.greeting, Object.keys(second).join(), require(specifier) === second);
  `,
};

const page = {
  "page.html": `<!doctype html><html><body><script type="module" src="./a.js"></script></body></html>\n`,
  "a.js": `import { b } from "./b.js";\nconsole.log(b + 1);\n`,
  "b.js": `export const b = 41;\n`,
};

function filesOf(folder: string) {
  return Object.fromEntries(
    readdirSync(folder)
      .sort()
      .map(name => [name, readFileSync(join(folder, name), "utf8")]),
  );
}

for (const command of [["build", "--compile", "--aot"], ["compile"]]) {
  test(`${command.join(" ")} --target=browser compiles entry points that are no pages`, async () => {
    using dir = tempDir("aot-browser-target-program", program);
    const root = realpathSync(String(dir));
    const executable = join(root, isWindows ? "program.exe" : "program");
    const flags = ["--target=browser", "--format=cjs", "./entry.js", "./second.js", "--outfile", executable];
    const build = await spawned([bunExe(), ...command, ...flags], root, bunEnv);
    built(build);
    expect(build.stdout).toMatch(buildId);
    const plain = await spawned([bunExe(), "entry.js"], root, bunEnv);
    const compiled = await spawned([executable], root, bunEnv);
    expect(plain.stdout).toBe("hello from second greeting true\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);

  for (const option of ["--format=iife", "--sourcemap=inline", "--sourcemap=linked"]) {
    test(`${command.join(" ")} --target=browser ${option} writes the page that a build without --aot writes`, async () => {
      using dir = tempDir("aot-browser-target-page", page);
      const root = realpathSync(String(dir));
      const flags = ["--target=browser", option, "./page.html"];
      const plain = await spawned([bunExe(), "build", "--compile", ...flags, "--outdir", "plain"], root, bunEnv);
      const asked = await spawned([bunExe(), ...command, ...flags, "--outdir", "asked"], root, bunEnv);
      expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect({ stderr: asked.stderr, exitCode: asked.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(asked.stdout).not.toMatch(buildId);
      expect(filesOf(join(root, "asked"))).toEqual(filesOf(join(root, "plain")));
    }, 120_000);
  }
}

test("Bun.build with compile.aot and target browser keeps the format of a page", async () => {
  using dir = tempDir("aot-browser-target-api", {
    ...page,
    "build.js": `
      for (const [outdir, compile] of [["plain", true], ["asked", { aot: true }]]) {
        const result = await Bun.build({ entrypoints: ["./page.html"], target: "browser", format: "iife", compile, outdir });
        if (!result.success) throw new AggregateError(result.logs);
      }
    `,
  });
  const root = realpathSync(String(dir));
  const build = await spawned([bunExe(), "build.js"], root, bunEnv);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(filesOf(join(root, "asked"))).toEqual(filesOf(join(root, "plain")));
}, 120_000);

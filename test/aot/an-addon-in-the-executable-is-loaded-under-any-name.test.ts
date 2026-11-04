// A native addon that lies in the executable is no code from disk. `import path from "./addon.node" with { type: "file" }` puts the file there and hands the program its path,
// and an executable that only runs what was compiled into it loads the addon under whatever name it is asked for, as an executable built without --aot does.
// An addon on disk stays refused, and so does a script that lies in the executable as a file: that is text that nobody has compiled.
// ./addons-named-by-the-platform/addon.c is built with the system's C compiler against the headers in src/runtime/napi, without node-gyp.
import { describe, expect } from "bun:test";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join, resolve } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { afterAll, beforeAll, test } from "./harness/default-timeout";

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

if (!systemCC)
  console.error(
    "SKIPPED: test/aot/an-addon-in-the-executable-is-loaded-under-any-name.test.ts: there is no C compiler: not in $CC, no cc, gcc or clang",
  );

const says = `const say = (label: string, ask: () => unknown) => {
  try {
    console.log(label, JSON.stringify(ask()));
  } catch (error) {
    console.log(label, (error as { code?: string }).code, (error as Error).message.includes("it isn't in this executable") ? "it isn't in this executable" : (error as Error).message);
  }
};
`;

// No name below is written where the build can read it.
const inTheExecutable = `import given from "./addon.node" with { type: "file" };
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
${says}
const made = [given].join("");
const listed = Bun.embeddedFiles.map(file => (file as unknown as { name: string }).name).find(name => given.endsWith(name))!;
say("the path that the import gave", () => require(made).add(40, 2));
say("a name out of Bun.embeddedFiles", () => require(join(dirname(given), listed)).add(40, 2));
say("a file URL", () => require(pathToFileURL(made).href).add(40, 2));
say("what createRequire() made", () => createRequire(__filename)(made).add(40, 2));
say("module.require", () => module.require(made).add(40, 2));
say("process.dlopen", () => {
  const loaded = { exports: {} as { add(left: number, right: number): number } };
  process.dlopen(loaded, made);
  return loaded.exports.add(40, 2);
});
import(made).then(
  () => console.log("import() loads it"),
  error => console.log("import()", error.name, error.message),
);
`;

const outsideOrText = `import given from "./addon.node" with { type: "file" };
import text from "./script.mjs" with { type: "file" };
${says}
say("the addon in the executable", () => require([given].join("")).add(40, 2));
say("an addon on disk", () => require(process.argv[2]).add(40, 2));
say("a script on disk", () => require(process.argv[3]).add(40, 2));
say("a script that lies in the executable as a file", () => require([text].join("")).add(40, 2));
`;

describe.skipIf(!systemCC || !!unsupported || isWindows)("compile/aot/an-addon-in-the-executable", () => {
  const folder = String(tempDir("aot-addon-in-the-executable", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const sources = join(folder, "sources");
  const disk = join(folder, "disk");
  const elsewhere = join(folder, "elsewhere");

  beforeAll(async () => {
    for (const made of [sources, disk, elsewhere]) mkdirSync(made);
    const compile = await spawned(
      [
        systemCC!,
        "-shared",
        "-fPIC",
        ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
        "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
        join(import.meta.dir, "addons-named-by-the-platform", "addon.c"),
        "-o",
        join(sources, "addon.node"),
      ],
      sources,
      bunEnv,
    );
    expect({ stderr: compile.stderr, exitCode: compile.exitCode }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
    const script = "export const add = (left, right) => left + right;\n";
    writeFileSync(join(sources, "script.mjs"), script);
    writeFileSync(join(sources, "in-the-executable.cts"), inTheExecutable);
    writeFileSync(join(sources, "outside-or-text.cts"), outsideOrText);
    copyFileSync(join(sources, "addon.node"), join(disk, "on-disk.node"));
    writeFileSync(join(disk, "on-disk.mjs"), script);
  });

  const executables = async (name: string) => {
    const made = { plain: join(elsewhere, name + "-plain"), closed: join(elsewhere, name + "-closed") };
    built(await spawned([bunExe(), "build", "--compile", name + ".cts", "--outfile", made.plain], sources, bunEnv));
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", name + ".cts", "--outfile", made.closed],
        sources,
        bunEnv,
      ),
    );
    return made;
  };
  const said = ({ stdout, stderr, exitCode }: { stdout: string; stderr: string; exitCode: number }) => ({
    lines: stdout.split("\n").filter(Boolean),
    stderr,
    exitCode,
  });

  test(
    "it loads under every name, as in an executable built without --aot",
    () =>
      slot(async () => {
        const { plain, closed } = await executables("in-the-executable");
        const reference = said(await spawned([plain], elsewhere, bunEnv));
        expect(reference).toEqual({
          lines: [
            "the path that the import gave 42",
            "a name out of Bun.embeddedFiles 42",
            "a file URL 42",
            "what createRequire() made 42",
            "module.require 42",
            "process.dlopen 42",
            "import() TypeError To load Node-API modules, use require() or process.dlopen instead of import.",
          ],
          stderr: "",
          exitCode: 0,
        });
        expect(said(await spawned([closed], elsewhere, bunEnv))).toEqual(reference);
      }),
    600_000,
  );

  test(
    "an addon on disk, a script on disk and a script that lies in the executable as a file stay refused beside it",
    () =>
      slot(async () => {
        const { plain, closed } = await executables("outside-or-text");
        const names = [join(disk, "on-disk.node"), join(disk, "on-disk.mjs")];
        expect(said(await spawned([plain, ...names], elsewhere, bunEnv)).lines).toEqual([
          "the addon in the executable 42",
          "an addon on disk 42",
          "a script on disk 42",
          "a script that lies in the executable as a file 42",
        ]);
        expect(said(await spawned([closed, ...names], elsewhere, bunEnv))).toEqual({
          lines: [
            "the addon in the executable 42",
            "an addon on disk MODULE_NOT_FOUND it isn't in this executable",
            "a script on disk MODULE_NOT_FOUND it isn't in this executable",
            "a script that lies in the executable as a file MODULE_NOT_FOUND it isn't in this executable",
          ],
          stderr: "",
          exitCode: 0,
        });
      }),
    600_000,
  );
});

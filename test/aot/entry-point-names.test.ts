// `bun build --compile` embeds every entry point but the first as `<stem>.js`, whatever the extension of its source was, and finds
// it under any extension of JavaScript or TypeScript. Programs start workers and import modules by those names, and tools read
// them from the executable. With --aot the same names find the same modules. What a module shows as its own path is another
// matter: that is the path of its source below the virtual root.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { test } from "./supported";

setDefaultTimeout(240_000);

const virtualRoot = isWindows ? "B:/~BUN/root/" : "/$bunfs/root/";
const stems = { typed: "ts", module: "mjs", plain: "js", common: "cjs" };
const extensions = ["js", "ts", "mjs", "cjs"];

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { typeRoots: [join(import.meta.dir, "../../packages")], types: ["bun-types"], allowJs: true },
  }),
  "src/main.ts": `
    async function importedFrom(name: string): Promise<string> {
      try {
        return ((await import(name)) as { who: string }).who;
      } catch (error) {
        return (error as Error).name;
      }
    }
    function answerOfWorker(name: string): Promise<string> {
      return new Promise(resolve => {
        const worker = new Worker(name);
        worker.onmessage = event => {
          resolve(String(event.data));
          worker.terminate();
        };
        worker.onerror = () => resolve("error");
      });
    }
    const bases: [string, string][] = [["absolute", import.meta.dir + "/sub/"], ["relative", "./sub/"]];
    for (const [kind, base] of bases) {
      for (const stem of ${JSON.stringify(Object.keys(stems))})
        for (const extension of ${JSON.stringify(extensions)}) console.log(kind, stem + "." + extension, await importedFrom(base + stem + "." + extension));
      for (const extension of ["js", "ts"]) console.log(kind, "worker." + extension, await answerOfWorker(base + "worker." + extension));
    }
  `,
  "src/sub/typed.ts": `export const who: string = "typed.ts"; export const path: string = import.meta.path;`,
  "src/sub/module.mjs": `export const who = "module.mjs";`,
  "src/sub/plain.js": `export const who = "plain.js";`,
  "src/sub/common.cjs": `exports.who = "common.cjs";`,
  "src/sub/worker.ts": `postMessage("worker.ts"); export {};`,
  "src/shown.ts": `
    const typed = (await import(import.meta.dir + "/sub/typed.js")) as { path: string };
    console.log(import.meta.path.replaceAll("\\\\", "/"));
    console.log(typed.path.replaceAll("\\\\", "/"));
  `,
};

const additional = [
  "src/sub/typed.ts",
  "src/sub/module.mjs",
  "src/sub/plain.js",
  "src/sub/common.cjs",
  "src/sub/worker.ts",
];

const expected = ["absolute", "relative"]
  .flatMap(kind => [
    ...Object.entries(stems).flatMap(([stem, written]) =>
      extensions.map(extension => `${kind} ${stem}.${extension} ${stem}.${written}`),
    ),
    `${kind} worker.js worker.ts`,
    `${kind} worker.ts worker.ts`,
  ])
  .join("\n");

async function build(folder: string, flags: string[], entryPoints: string[], name: string): Promise<string> {
  const executable = join(folder, name + (isWindows ? ".exe" : ""));
  built(
    await spawned([bunExe(), "build", "--compile", ...flags, ...entryPoints, "--outfile", executable], folder, bunEnv),
  );
  return executable;
}

for (const [title, flags] of [
  ["bundled", []],
  ["compiled", ["--aot"]],
] as const) {
  test(`${title}: an entry point is found under the name of its output and under every extension`, async () => {
    using dir = tempDir("aot-entry-point-names", files);
    using elsewhere = tempDir("aot-entry-point-names-elsewhere", {});
    const executable = await build(String(dir), [...flags], ["src/main.ts", ...additional], title);
    const run = await spawned([executable], String(elsewhere), bunEnv);
    expect({ stdout: run.stdout.trim(), exitCode: run.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
  });

  test(`${title}: the executable lists its entry points under the names of their outputs`, async () => {
    using dir = tempDir("aot-entry-point-names-list", files);
    const bytes = readFileSync(await build(String(dir), [...flags], ["src/main.ts", ...additional], title));
    const isListed = (name: string) => bytes.includes(Buffer.from(virtualRoot + name + "\0"));
    const names = [...Object.keys(stems), "worker"].map(stem => `sub/${stem}.js`);
    expect(names.filter(name => !isListed(name))).toEqual([]);
  });
}

test("compiled: a module shows the path of its source", async () => {
  using dir = tempDir("aot-entry-point-names-shown", files);
  using elsewhere = tempDir("aot-entry-point-names-shown-elsewhere", {});
  const executable = await build(String(dir), ["--aot"], ["src/shown.ts", "src/sub/typed.ts"], "shown");
  const run = await spawned([executable], String(elsewhere), bunEnv);
  expect({ stdout: run.stdout.trim(), exitCode: run.exitCode }).toEqual({
    stdout: `${virtualRoot}shown.ts\n${virtualRoot}sub/typed.ts`,
    exitCode: 0,
  });
});

test("compiled: two entry points with one output name are an error, as in a bundle", async () => {
  using dir = tempDir("aot-entry-point-names-equal", {
    ...files,
    "src/sub/typed.mjs": `export const who = "typed.mjs";`,
  });
  for (const flags of [[], ["--aot"]]) {
    const result = await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        ...flags,
        "src/main.ts",
        "src/sub/typed.ts",
        "src/sub/typed.mjs",
        "--outfile",
        join(String(dir), "equal"),
      ],
      String(dir),
      bunEnv,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Multiple files share the same output path");
  }
});

// `bun build --compile` embeds every entry point but the first as `<stem>.js`, whatever the extension of its source was, and finds
// it under any extension of JavaScript or TypeScript. Programs start workers and import modules by those names, and tools read
// them from the executable. With --aot the same names find the same modules. What a module shows as its own path is another
// matter: that is the path of its source below the virtual root.
import { afterAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { test as oneAtATime } from "./supported";

setDefaultTimeout(240_000);

// Each test has folders of its own. The two that ask one executable only read it.
const test = oneAtATime.concurrent;

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

const sameStem = {
  "tsconfig.json": files["tsconfig.json"],
  "same.js": `
    console.log("same.js");
    const name = process.argv.length > 99 ? "" : "./same.ts";
    console.log("import", (await import(name)).who);
    const worker = new Worker(name);
    worker.onmessage = event => {
      console.log("worker", event.data);
      worker.terminate();
    };
  `,
  "same.ts": `export const who: string = "same.ts"; if (!Bun.isMainThread) postMessage(who);`,
  "main.ts": `
    const worker = new Worker("./task.js");
    worker.onmessage = event => {
      console.log(event.data);
      worker.terminate();
    };
  `,
  "task.js": `postMessage("task.js");`,
  "task.ts": `postMessage("task.ts"); export {};`,
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
      extensions.map(extension => `${kind} ${stem}.${extension} ${stem}.${written}\n`),
    ),
    `${kind} worker.js worker.ts\n`,
    `${kind} worker.ts worker.ts\n`,
  ])
  .join("");

async function build(folder: string, flags: string[], entryPoints: string[], name: string): Promise<string> {
  const executable = join(folder, name + (isWindows ? ".exe" : ""));
  built(
    await spawned([bunExe(), "build", "--compile", ...flags, ...entryPoints, "--outfile", executable], folder, bunEnv),
  );
  return executable;
}

const shared: Disposable[] = [];
afterAll(() => {
  for (const folder of shared) folder[Symbol.dispose]();
});

for (const [title, flags] of [
  ["bundled", []],
  ["compiled", ["--aot"]],
] as const) {
  // One test asks what this executable prints, one what its file holds: one build, in a folder that outlives both.
  let once: Promise<string> | undefined;
  function withEveryEntryPoint(): Promise<string> {
    if (!once) {
      const dir = tempDir("aot-entry-point-names", files);
      shared.push(dir);
      once = build(String(dir), [...flags], ["src/main.ts", ...additional], title);
    }
    return once;
  }

  test(`${title}: an entry point is found under the name of its output and under every extension`, async () => {
    using elsewhere = tempDir("aot-entry-point-names-elsewhere", {});
    const run = await spawned([await withEveryEntryPoint()], String(elsewhere), bunEnv);
    expect(run).toEqual({ stdout: expected, stderr: "", exitCode: 0, signal: null });
  });

  test(`${title}: the executable lists its entry points under the names of their outputs`, async () => {
    const bytes = readFileSync(await withEveryEntryPoint());
    // The file is the size of Bun and the names are near its end.
    const isListed = (name: string) => bytes.lastIndexOf(Buffer.from(virtualRoot + name + "\0")) !== -1;
    const names = [...Object.keys(stems), "worker"].map(stem => `sub/${stem}.js`);
    expect(names.filter(name => !isListed(name))).toEqual([]);
  });

  test(`${title}: the first entry point starts beside one whose output has the name of its source`, async () => {
    using dir = tempDir("aot-entry-point-names-same-stem", sameStem);
    using elsewhere = tempDir("aot-entry-point-names-same-stem-elsewhere", {});
    const executable = await build(String(dir), [...flags], ["./same.js", "./same.ts"], title);
    const run = await spawned([executable], String(elsewhere), bunEnv);
    expect(run).toEqual({
      stdout: "same.js\nimport same.ts\nworker same.ts\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    });
  });

  test(`${title}: the executable starts with the first entry point that is a script`, async () => {
    using dir = tempDir("aot-entry-point-names-first-script", {
      "page.css": `body {}`,
      "page.html": `<p>page</p>`,
      "first.js": `console.log("first.js", import.meta.main);`,
      "second.js": `console.log("second.js");`,
    });
    const others = ["./page.css", "./page.html"];
    const executable = await build(String(dir), [...flags], [...others, "./first.js", "./second.js"], title);
    const run = await spawned([executable], String(dir), bunEnv);
    expect(run).toEqual({ stdout: "first.js true\n", stderr: "", exitCode: 0, signal: null });

    const command = [bunExe(), "build", "--compile", ...flags, ...others, "--outfile", join(String(dir), "none")];
    const refused = await spawned(command, String(dir), bunEnv);
    expect(refused).toMatchObject({ stderr: expect.stringContaining("No output files to bundle"), exitCode: 1 });
    expect(readdirSync(String(dir)).filter(name => name.startsWith("none"))).toEqual([]);
  });
}

test("compiled: a Worker starts from the source it names beside an entry point whose output has that name", async () => {
  using dir = tempDir("aot-entry-point-names-worker", sameStem);
  using elsewhere = tempDir("aot-entry-point-names-worker-elsewhere", {});
  const executable = await build(String(dir), ["--aot"], ["./main.ts", "./task.ts"], "worker");
  const run = await spawned([executable], String(elsewhere), bunEnv);
  expect(run).toEqual({ stdout: "task.js\n", stderr: "", exitCode: 0, signal: null });
});

test("compiled: a module shows the path of its source", async () => {
  using dir = tempDir("aot-entry-point-names-shown", files);
  using elsewhere = tempDir("aot-entry-point-names-shown-elsewhere", {});
  const executable = await build(String(dir), ["--aot"], ["src/shown.ts", "src/sub/typed.ts"], "shown");
  const run = await spawned([executable], String(elsewhere), bunEnv);
  expect(run).toEqual({
    stdout: `${virtualRoot}shown.ts\n${virtualRoot}sub/typed.ts\n`,
    stderr: "",
    exitCode: 0,
    signal: null,
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
    // The error names the output that the two share.
    expect(result).toMatchObject({
      stderr: expect.stringMatching(/Multiple files share the same output path[^]*\bsub[\\/]typed\.js\b/),
      exitCode: 1,
    });
    expect(readdirSync(String(dir)).filter(name => name.startsWith("equal"))).toEqual([]);
  }
});

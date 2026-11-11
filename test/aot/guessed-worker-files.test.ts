import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Where no start of a Worker tells its file, the build also compiles the files that texts of the program name. Such a text may be there for another use. So
// - it leads to files of the root directory alone, and the working directory doesn't count,
// - what it leads to stops no build,
// - the build lists what came in that way, and TS100082 names what was left out.
const env = { ...bunEnv, NO_COLOR: "1" };
const job = `postMessage("job");\n`;
const start = `const start = file => {
  const worker = new Worker(file);
  const say = (...said) => (console.log("SEEN", ...said), worker.terminate());
  if (worker.on) worker.on("message", data => say(data)).on("error", () => say("error"));
  else {
    worker.onmessage = event => say(event.data);
    worker.onerror = event => (event.preventDefault(), say("error"));
  }
};\n`;
const startFromArgument = `if (process.argv[2]) start(process.argv[2]);\n`;
const startsJob = (...names: string[]) => `${start}console.log(${JSON.stringify(names)});\n${startFromArgument}`;

type Case = {
  files: Record<string, string>;
  links?: Record<string, string>;
  cwd: string;
  /** The entry points and flags. */
  command?: string[];
  /** The options of `Bun.build` in place of a command. */
  options?: string;
  starts?: string;
  seen: string[];
  /** The files that came in by a guess. */
  holds?: string[];
  /** What TS100082 says besides. */
  leftOut?: string;
};

async function build(folder: string, { cwd, command = ["main.js"], options }: Case, outfile: string) {
  const from = join(folder, cwd);
  const saysWhatItTakes = { ...env, BUN_JSC_logAOTPhaseTimes: "1" };
  if (!options) {
    return await run(
      [bunExe(), "build", "--compile", "--aot", ...command, "--outfile", outfile],
      from,
      saysWhatItTakes,
    );
  }
  const script = `const { success, logs } = await Bun.build({ ${options}, compile: { aot: true, outfile: ${JSON.stringify(outfile)} }, throw: false });
for (const log of logs) console.error(log.level + ": " + log.message);
process.exitCode = success ? 0 : 1;\n`;
  return await run([bunExe(), "-e", script], from, saysWhatItTakes);
}

// The files that the load has taken for files of Workers.
const taken = (said: string) =>
  [...said.matchAll(/^AOT load goes on \| with (\d+) more files that Workers start from$/gm)].map(match =>
    Number(match[1]),
  );

const listed = (said: string) => {
  const note = /TS100168: .*?: (.*)$/m.exec(said);
  return note ? note[1].replaceAll("\\", "/").split(", ") : [];
};

async function check(one: Case) {
  using sources = tempDir("aot-guessed-worker-files", one.files);
  using elsewhere = tempDir("aot-guessed-worker-files-run", {});
  const folder = join(String(sources), "in");
  mkdirSync(folder);
  for (const name in one.files) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    renameSync(join(String(sources), name), join(folder, name));
  }
  for (const link in one.links) {
    mkdirSync(dirname(join(folder, link)), { recursive: true });
    symlinkSync(one.links[link], join(folder, link));
  }
  mkdirSync(join(folder, one.cwd), { recursive: true });
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const built = await build(folder, one, executable);
  expect({
    stderr: built.exitCode ? built.stderr : "",
    exitCode: built.exitCode,
  }).toEqual({ stderr: "", exitCode: 0 });
  const holds = one.holds ?? [];
  const seen = { taken: taken(built.stderr), listed: listed(built.stderr) };
  expect(seen).toEqual({
    taken: holds.length ? [holds.length] : [],
    listed: holds,
  });
  if (one.leftOut) expect(built.stderr.replaceAll("\\", "/")).toContain(one.leftOut);
  rmSync(folder, { recursive: true });
  const { stdout, exitCode } = await run([executable, ...(one.starts ? [one.starts] : [])], String(elsewhere), env);
  expect(stdout.split("\n").filter(line => line.startsWith("SEEN"))).toEqual(one.seen);
  expect(exitCode).toBe(0);
  return built.stderr;
}

const outside = (file: string, name: string, place: string) =>
  `outside the root directory that the program only names: ${file} (named "${name}" at ${place}). If a Worker starts from one, add it as an entry point`;
const above = {
  files: { "app/main.js": startsJob("../job.js"), "job.js": job },
  cwd: "app",
  starts: "../job.js",
};
const namedAbove = outside("../job.js", "../job.js", "main.js:10:14");
const threads = `import { Worker } from "node:worker_threads";\n`;
const onlyIn = (folder: string) => ({
  "main.js": startsJob("./job.js"),
  [`${folder}/job.js`]: job,
});

const cases: Record<string, Case> = {
  "a file above the root directory": {
    ...above,
    seen: ["SEEN error"],
    leftOut: namedAbove,
  },
  "a file above it, for a Worker of node:worker_threads": {
    ...above,
    files: { "app/main.js": threads + startsJob("../job.js"), "job.js": job },
    seen: ["SEEN error"],
    leftOut: outside("../job.js", "../job.js", "main.js:11:14"),
  },
  "a file above it, where the Worker starts from a URL": {
    ...above,
    files: {
      "app/main.js": startsJob("../job.js").replace(
        "start(process.argv[2])",
        "start(new URL(process.argv[2], import.meta.url))",
      ),
      "job.js": job,
    },
    seen: ["SEEN error"],
    leftOut: namedAbove,
  },
  "a file above it, where the only Worker is in a function that nothing calls": {
    files: {
      "app/main.js": `const names = ["../job.js"];\nconsole.log("SEEN", names);\nfunction unused(file) {\n  new Worker(file);\n}\n`,
      "job.js": job,
    },
    cwd: "app",
    seen: ['SEEN [ "../job.js" ]'],
  },
  "a file above the root of Bun.build": {
    files: { "app/src/main.js": startsJob("../job.js"), "app/job.js": job },
    cwd: "app",
    options: `entrypoints: ["./src/main.js"], root: "./src"`,
    starts: "../job.js",
    seen: ["SEEN error"],
    leftOut: outside("job.js", "../job.js", "src/main.js:10:14"),
  },
  "a file of a wider root of Bun.build": {
    files: {
      "app/src/main.js": startsJob("../job.js"),
      "app/job.js": job,
      "job.js": "broken (",
    },
    cwd: "app",
    options: `entrypoints: ["./src/main.js"], root: "."`,
    starts: "../job.js",
    seen: ["SEEN job"],
    holds: ["job.js (named at src/main.js:10:14)"],
  },
  "a file above it that is an entry point": {
    ...above,
    command: ["main.js", "../job.js"],
    seen: ["SEEN job"],
  },
  "a file of the root directory": {
    files: {
      "app/main.js": startsJob("./jobs/job.js"),
      "app/jobs/job.js": job,
    },
    cwd: "app",
    starts: "./jobs/job.js",
    seen: ["SEEN job"],
    holds: ["jobs/job.js (named at main.js:10:14)"],
  },
  "a file of the root directory, named by way of the folder above": {
    files: { "app/main.js": startsJob("../app/job.js"), "app/job.js": job },
    cwd: ".",
    command: ["app/main.js"],
    starts: "../app/job.js",
    seen: ["SEEN job"],
    holds: ["app/job.js (named at app/main.js:10:14)"],
  },
  "a file of the root directory, named from the folder of the project": {
    files: {
      "project/src/main.js": startsJob("./src/job.js"),
      "project/src/job.js": job,
    },
    cwd: "elsewhere",
    command: ["../project/src/main.js"],
    starts: "./src/job.js",
    seen: ["SEEN job"],
    holds: ["../project/src/job.js (named at ../project/src/main.js:10:14)"],
  },
  "a file of the working directory": {
    files: {
      "project/app/main.js": startsJob("./job.js"),
      "project/job.js": job,
    },
    cwd: "project",
    command: ["app/main.js"],
    starts: "./job.js",
    seen: ["SEEN error"],
    leftOut: outside("job.js", "./job.js", "app/main.js:10:14"),
  },
  "a URL made of the own folder is the name of its file, wherever that lies": {
    files: {
      "project/bin/main.js": `import { start } from "../src/start.js";\nstart(new URL("../src/job.js", import.meta.url));\n`,
      "project/src/start.js": `export ${start}`,
      "project/src/job.js": job,
    },
    cwd: "project/bin",
    seen: ["SEEN job"],
    holds: ["../src/job.js (named at main.js:2:7)"],
  },
  backslashes: {
    files: {
      "app/main.js": `${start}console.log(".\\\\job.js", "./..\\\\job.js", "..\\\\job.js");\n${startFromArgument}`,
      "app/job.js": job,
      "job.js": "broken (",
    },
    cwd: "app",
    seen: [],
  },
  "what a package writes": {
    files: {
      "app/main.js": `import { start, names } from "a-package";\nconsole.log(names);\n${startFromArgument}`,
      "app/node_modules/a-package/package.json": `{ "name": "a-package", "type": "module", "main": "index.js" }`,
      "app/node_modules/a-package/index.js": `export const names = ["./job.js", "../job.js", "./index.js"];\nexport ${start}`,
      "app/job.js": "broken (",
      "job.js": "broken (",
    },
    cwd: "app",
    starts: "./job.js",
    seen: ["SEEN error"],
  },
  "what a module of a plugin's own namespace writes": {
    files: {
      "app/main.js": `import { start, names } from "made-up";\nconsole.log(names);\n${startFromArgument}`,
      "app/job.js": "broken (",
    },
    cwd: "app",
    options: `entrypoints: ["./main.js"], plugins: [{ name: "made up", setup(build) {
      build.onResolve({ filter: /^made-up$/ }, () => ({ path: "made-up", namespace: "made-up" }));
      build.onLoad({ filter: /./, namespace: "made-up" }, () => ({ loader: "js", contents: ${JSON.stringify(`export const names = ["./job.js"];\nexport ${start}`)} }));
    } }]`,
    starts: "./job.js",
    seen: ["SEEN error"],
  },
  "a plugin that keeps the file out": {
    files: { "app/main.js": startsJob("./job.js"), "app/job.js": job },
    cwd: "app",
    options: `entrypoints: ["./main.js"], plugins: [{ name: "keeps out", setup(build) {
      build.onResolve({ filter: /job/ }, ({ path }) => ({ path, external: true }));
    } }]`,
    starts: "./job.js",
    seen: ["SEEN error"],
    leftOut: `A plugin keeps out files that the program names: job.js (named "./job.js" at main.js:10:14)`,
  },
  "a plugin that refuses the name": {
    files: { "app/main.js": startsJob("./job.js"), "app/job.js": job },
    cwd: "app",
    options: `entrypoints: ["./main.js"], plugins: [{ name: "refuses", setup(build) {
      build.onResolve({ filter: /job/ }, ({ path }) => { throw new Error("refused: " + path); });
    } }]`,
    starts: "./job.js",
    seen: ["SEEN error"],
    leftOut: "refused: ./job.js",
  },
  "a plugin is asked of no name that leads nowhere": {
    files: { "app/main.js": startsJob("./absent.js", "../absent.js") },
    cwd: "app",
    options: `entrypoints: ["./main.js"], plugins: [{ name: "refuses", setup(build) {
      build.onResolve({ filter: /absent/ }, ({ path }) => { throw new Error("refused: " + path); });
    } }]`,
    seen: [],
  },
};

if (!isWindows) {
  cases["a symbolic link in the root directory to a file outside it"] = {
    files: { "app/main.js": startsJob("./link.js"), "job.js": job },
    links: { "app/link.js": "../job.js" },
    cwd: "app",
    starts: "./link.js",
    seen: ["SEEN error"],
    leftOut: outside("../job.js", "./link.js", "main.js:10:14"),
  };
  cases["a symbolic link in the root directory to a folder outside it"] = {
    files: { "app/main.js": startsJob("./jobs/job.js"), "jobs/job.js": job },
    links: { "app/jobs": "../jobs" },
    cwd: "app",
    starts: "./jobs/job.js",
    seen: ["SEEN error"],
    leftOut: outside("../jobs/job.js", "./jobs/job.js", "main.js:10:14"),
  };
  cases["a root directory behind a symbolic link"] = {
    files: {
      "real/app/main.js": startsJob("./job.js"),
      "real/app/job.js": job,
    },
    links: { linked: "real" },
    cwd: "linked/app",
    command: ["main.js", "--root", "."],
    starts: "./job.js",
    seen: ["SEEN job"],
    holds: ["job.js (named at main.js:10:14)"],
  };
}

test.concurrent.each(Object.keys(cases))("%s", async name => {
  await check(cases[name]);
});

// None of them can be compiled. Most stopped the build or failed in silence.
const refused: Record<
  string,
  {
    files: Record<string, string>;
    says: string;
    options?: string;
    seen?: string;
  }
> = {
  "a syntax error": {
    files: { "job.js": "const = ;\n" },
    says: `"job.js" is only compiled because a Worker may start from it, and it can't be: `,
  },
  "an import that leads nowhere": {
    files: { "job.js": `import "./absent.js";\n` },
    says: `TS100150: Could not resolve: "./absent.js"`,
  },
  "an import of a name that isn't exported": {
    files: {
      "job.js": `import { absent } from "./other.js";\nconsole.log(absent);\n`,
      "other.js": "export const other = 1;\n",
    },
    says: "TS100168",
  },
  "a file with a syntax error that it imports": {
    files: { "job.js": `import "./other.js";\n`, "other.js": "const = ;\n" },
    says: `"other.js" is only compiled because a Worker may start from it, and it can't be: `,
  },
  "a macro": {
    files: {
      "job.js": `import { made } from "./macro.js" with { type: "macro" };\npostMessage(made());\n`,
      "macro.js": `export const made = () => "made";\n`,
    },
    says: `"job.js" is only compiled because a Worker may start from it, and it can't be: Macros are disabled`,
  },
  "a query in a require()": {
    files: {
      "job.js": `const text = require("./other.js?raw");\npostMessage(text);\n`,
      "other.js": "exports.other = 1;\n",
    },
    says: `TS100150: Could not resolve: "./other.js?raw"`,
  },
  "a page that can't be bundled": {
    files: {
      "job.js": `import page from "./page.html";\npostMessage(typeof page);\n`,
      "page.html": `<script src="./absent.js"></script>\n`,
    },
    says: `"page.html" is only compiled because a Worker may start from it, and it can't be: Could not resolve: "./absent.js"`,
  },
  "a plugin that fails to load it": {
    files: { "job.js": job },
    options: `entrypoints: ["./main.js"], plugins: [{ name: "fails", setup(build) {
      build.onLoad({ filter: /job/ }, () => { throw new Error("fails to load"); });
    } }]`,
    says: `"job.js" is only compiled because a Worker may start from it, and it can't be: fails to load`,
  },
  "a type error": {
    files: {
      "job.ts": `const size: number = "large";\npostMessage(size + "!");\n`,
    },
    says: "TS2322: Type 'string' is not assignable to type 'number'.",
    seen: "SEEN large!",
  },
  "a type error in what it imports": {
    files: {
      "job.ts": `import { size } from "./size";\npostMessage(size + "!");\n`,
      "size.ts": `export const size: number = "large";\n`,
    },
    says: "TS2322: Type 'string' is not assignable to type 'number'.",
    seen: "SEEN large!",
  },
};

test.concurrent.each(Object.keys(refused))("%s stops no build", async name => {
  const { files, says, options, seen = "SEEN error" } = refused[name];
  const file = "job.ts" in files ? "job.ts" : "job.js";
  const said = await check({
    files: { "main.js": startsJob(`./${file}`), ...files },
    cwd: ".",
    options,
    starts: `./${file}`,
    seen: [seen],
    holds: [`${file} (named at main.js:10:14)`],
  });
  expect(said).toContain(says);
});

test.concurrent("an asset that a plugin fails to load still stops the build", async () => {
  using dir = tempDir("aot-asset-beside-guessed-worker-file", {
    "main.js": `import logo from "./logo.png" with { type: "file" };\nconsole.log(logo);\n${startsJob("./job.js")}`,
    "job.js": job,
    "logo.png": "logo",
  });
  const options = `entrypoints: ["./main.js"], plugins: [{ name: "fails", setup(build) {
    build.onLoad({ filter: /logo/ }, () => { throw new Error("fails to load"); });
  } }]`;
  const built = await build(String(dir), { cwd: ".", options, seen: [] }, "program");
  expect(built.stderr).toContain("error: fails to load");
  expect(built.exitCode).toBe(1);
});

test.concurrent("what the program itself loads still stops the build", async () => {
  using dir = tempDir("aot-guessed-worker-files", {
    "main.ts": `import { size } from "./size";\nconst names = ["./job.ts"];\nconsole.log(names, size);\nif (process.argv[2]) new Worker(process.argv[2]);\n`,
    "job.ts": `import { size } from "./size";\npostMessage(size);\n`,
    "size.ts": `export const size: number = "large";\n`,
  });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "program"],
    String(dir),
    env,
  );
  expect(built.stderr).toContain("error: TS2322");
  expect(built.exitCode).toBe(1);
});

test.concurrent("--explain shows each place", async () => {
  using dir = tempDir("aot-guessed-worker-files", {
    "main.js": startsJob("./job.js"),
    "other.js": job,
    "job.js": `import "./other.js";\n`,
  });
  const command = [bunExe(), "build", "--compile", "--aot", "--explain", "main.js", "--outfile", "program"];
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  const said = stdout + stderr;
  expect(said).toContain(
    `TS100167: The executable holds "job.js", which this names, because a Worker may start from it`,
  );
  expect(said).toContain("main.js:10:14");
  expect(exitCode).toBe(0);
});

test.concurrent("the working directory makes no difference", async () => {
  using dir = tempDir("aot-guessed-worker-files", {
    "app/main.js": startsJob("./job.js", "../job.js", "./one/job.js"),
    "job.js": job,
    "one/job.js": job,
    "two/other.js": job,
  });
  const executables: Buffer[] = [];
  for (const cwd of ["one", "two"]) {
    const command = [bunExe(), "build", "--compile", "--aot", "../app/main.js", "--outfile", "../program"];
    const { stderr, exitCode } = await run(command, join(String(dir), cwd), env);
    expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const executable = join(String(dir), isWindows ? "program.exe" : "program");
    executables.push(readFileSync(executable));
    rmSync(executable);
  }
  expect(executables[0].equals(executables[1])).toBe(true);
});

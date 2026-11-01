import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test --aot` is several processes: one reads the flags and builds, then starts the run, and over layers each build is a process too.
// `bun run --aot` is two.
// `--env-file` may name a pipe, as in `--env-file=<(decrypt secrets)`, and a pipe can be read once. The first process reads the environment
// files and hands the values on in the environment, as the coordinator of `--parallel` does for its workers. What is a file is read by each
// process, as ever: an environment has a limit, and a .env may be longer.

const forms: [string, string[]][] = [
  ["TestRunLayers:0", []],
  ["TestRunLayers:0", ["--parallel=2"]],
  ["TestRunLayers:2,TestRunPartFiles:1", ["--parallel=2"]],
];

const sees = `import { expect, test } from "bun:test";
test("env", () => {
  expect(process.env.FROM_PIPE).toBe("1");
  expect(process.env.FROM_DOTENV).toBeUndefined();
});
`;

test.skipIf(isWindows).each(forms.flatMap(form => [["argv", ...form] as const, ["BUN_OPTIONS", ...form] as const]))(
  "a FIFO named by --env-file in %s is read once: %s %j",
  async (route, words, flags) => {
    using dir = tempDir("aot-env-file-pipe", {
      "package.json": `{ "name": "env-file-pipe" }`,
      "a.test.js": sees,
      "b.test.js": sees,
      ".env": "FROM_DOTENV=1\n",
    });
    const cwd = String(dir);
    expect(Bun.spawnSync(["mkfifo", join(cwd, "fifo")]).exitCode).toBe(0);
    await using writer = Bun.spawn({
      cmd: ["sh", "-c", "echo FROM_PIPE=1 > fifo"],
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    // A process that opens the FIFO again waits for a writer that never comes.
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--aot", ...flags, ...(route === "argv" ? ["--env-file=fifo"] : [])],
      cwd,
      {
        ...bunEnv,
        NO_COLOR: "1",
        BUN_DEBUG_TEST_AOT_WORDS: words,
        ...(route === "BUN_OPTIONS" ? { BUN_OPTIONS: "--env-file=fifo" } : {}),
      },
    );
    expect({ counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode }).toEqual({
      counts: [" 2 pass", " 0 fail"],
      exitCode: 0,
    });
    expect(await writer.exited).toBe(0);
  },
  120_000,
);

// The first looks for a script of that name in package.json, and has read the environment files by then.
const spellings = [["run", "main.ts"], ["run", "./main.ts"], ["main.ts"]];

test.skipIf(isWindows).each(spellings.map(words => [words.join(" "), words] as const))(
  "bun %s: a FIFO named by --env-file is read once",
  async (_, words) => {
    using dir = tempDir("aot-env-file-pipe-run", {
      "package.json": `{ "name": "env-file-pipe" }`,
      "main.ts": `console.log(process.env.FROM_PIPE, process.env.FROM_DOTENV);`,
      ".env": "FROM_DOTENV=1\n",
    });
    const cwd = String(dir);
    expect(Bun.spawnSync(["mkfifo", join(cwd, "fifo")]).exitCode).toBe(0);
    await using writer = Bun.spawn({
      cmd: ["sh", "-c", "echo FROM_PIPE=1 > fifo"],
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const cmd = [bunExe(), ...words.slice(0, -1), "--aot", "--env-file=fifo", words.at(-1)!];
    const { stdout, stderr, exitCode } = await run(cmd, cwd);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "1 undefined\n", stderr: "", exitCode: 0 });
    expect(await writer.exited).toBe(0);
  },
  120_000,
);

const names = ["A", "B", "C", "D", "GIVEN", "EXPANDED", "QUOTED", "EMPTY", "ONE", "TWO", "ONLY_PRODUCTION", "NODE_ENV"];
const prints = `import { test } from "bun:test";
const names = ${JSON.stringify(names)};
test("env", () => {
  const seen = from => names.map(name => name + "=" + JSON.stringify(from[name])).join(" ");
  console.log("ROW process.env " + seen(process.env));
  console.log("ROW Bun.env " + seen(Bun.env));
  console.log("ROW import.meta.env " + seen(import.meta.env));
  const script = "console.log(JSON.stringify(" + JSON.stringify(names) + ".map(name => process.env[name])))";
  console.log("ROW child " + Bun.spawnSync([process.execPath, "--no-env-file", "-e", script], { cwd: "/" }).stdout.toString().trim());
  console.log("ROW keys " + Object.keys(process.env).filter(key => names.includes(key)).join());
});
`;

const setUps: [Record<string, string>, string[], string][] = [
  [
    {},
    [],
    `A="dotenv" B="test" C="test" D="test.local" GIVEN="dotenv" EXPANDED="x-dotenv-dotenv" QUOTED="two words" EMPTY=""`,
  ],
  [{ GIVEN: "process", NODE_ENV: "production" }, [], `GIVEN="process" EXPANDED="x-dotenv-process"`],
  [{ A: "process" }, ["--env-file=one.env", "--env-file=two.env"], `A="process" B=undefined`],
  [{}, ["--no-env-file"], `A=undefined B=undefined`],
];

test.each(setUps)(
  "what the environment files give is what bun test gives: %j %j",
  async (variables, flags, some) => {
    using dir = tempDir("aot-env-files", {
      "package.json": `{ "name": "env-files" }`,
      "a.test.js": prints,
      ".env":
        'A=dotenv\nB=dotenv\nC=dotenv\nD=dotenv\nGIVEN=dotenv\nEXPANDED=x-$A-$GIVEN\nQUOTED="two words"\nEMPTY=\n',
      ".env.test": "B=test\nC=test\nD=test\n",
      ".env.local": "C=local\nD=local\n",
      ".env.test.local": "D=test.local\n",
      ".env.production": "B=production\nONLY_PRODUCTION=1\n",
      "one.env": "A=one\nONE=1\n",
      "two.env": "A=two\nTWO=2\n",
    });
    const rowsOf = async (more: string[], words = "") => {
      const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words, ...variables };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...more, ...flags], String(dir), env);
      return { rows: stdout.split("\n").filter(line => line.startsWith("ROW ")), stderr: exitCode ? stderr : "" };
    };
    const plain = await rowsOf([]);
    expect(plain.rows.length).toBe(5);
    expect(plain.rows[0]).toContain(some);
    for (const [words, more] of forms) expect(await rowsOf(["--aot", ...more], words)).toEqual(plain);
  },
  240_000,
);

const printsAtOnce = prints
  .replace(`import { test } from "bun:test";\n`, "")
  .replace(`test("env", () => {`, "{")
  .replace(/\}\);\n$/, "}\n");

test.each([
  [{}, [], `A="dotenv" B="development" C="local" D="local"`],
  [{ GIVEN: "process", NODE_ENV: "production" }, [], `B="production" C="local" D="local" GIVEN="process"`],
  [{ A: "process" }, ["--env-file=one.env", "--env-file=two.env"], `A="process" B=undefined`],
] as [Record<string, string>, string[], string][])(
  "what the environment files give is what bun run gives: %j %j",
  async (variables, flags, some) => {
    using dir = tempDir("aot-env-files-run", {
      "package.json": `{ "name": "env-files" }`,
      "main.js": printsAtOnce,
      ".env":
        'A=dotenv\nB=dotenv\nC=dotenv\nD=dotenv\nGIVEN=dotenv\nEXPANDED=x-$A-$GIVEN\nQUOTED="two words"\nEMPTY=\n',
      ".env.test": "B=test\n",
      ".env.local": "C=local\nD=local\n",
      ".env.development": "B=development\n",
      ".env.production": "B=production\nONLY_PRODUCTION=1\n",
      "one.env": "A=one\nONE=1\n",
      "two.env": "A=two\nTWO=2\n",
    });
    const rowsOf = async (words: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), ...words], String(dir), { ...bunEnv, ...variables });
      return { rows: stdout.split("\n").filter(line => line.startsWith("ROW ")), stderr: exitCode ? stderr : "" };
    };
    for (const main of ["main.js", "./main.js"]) {
      const plain = await rowsOf(["run", ...flags, main]);
      expect(plain.rows.length).toBe(5);
      expect(plain.rows[0]).toContain(some);
      expect(await rowsOf(["run", "--aot", ...flags, main])).toEqual(plain);
    }
  },
  240_000,
);

test.skipIf(!isLinux).each([
  [["test", "--aot"], "a.test.js"],
  [["run", "--aot"], "main.js"],
])(
  "bun %j: the values of a file are not handed on in the environment",
  async (words, file) => {
    const prints = `console.log("ROW", process.env.FROM_FILE, require("node:fs").readFileSync("/proc/self/environ", "latin1").split("\\0").includes("FROM_FILE=1"));`;
    using dir = tempDir("aot-env-file-is-a-file", {
      "package.json": `{ "name": "env-file-is-a-file" }`,
      "a.test.js": `import { test } from "bun:test";\ntest("env", () => { ${prints} });\n`,
      "main.js": prints,
      "given.env": "FROM_FILE=1\n",
    });
    const { stdout, stderr } = await run([bunExe(), ...words, "--env-file=given.env", "./" + file], String(dir));
    expect(
      stdout.split("\n").filter(line => line.startsWith("ROW ")),
      stderr,
    ).toEqual(["ROW 1 false"]);
  },
  120_000,
);

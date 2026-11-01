// Tests the fuzzer's own judging (test/aot/fuzz) with a stand-in for the compiler. A fuzzer that books a failure as
// "skipped", or never finishes a run, looks like one that finds nothing.
//
//   a build that stops at a type error is checked with TypeScript: skipped if TypeScript rejects the program too, a finding if it accepts it
//   --project controls the project files: no tsconfig.json, an empty one, or the one from `bun init` with Bun's typings installed
//   a program that must be the entry point of its build is never a module of a shared build
//   after the end of a run a few failures are confirmed, the rest are listed, and nothing is built again
//   a build or a run that exceeds its memory limit is killed and reported, and everything a runner started exits with the fuzzer
//   a generated program cannot signal any process but itself
//   a program that fails in plain Bun is not run again for every mode
//   a multi-file program gets its own folder, alone and in a shared build, and TypeScript checks all its files
//   a finding in a multi-file program is first tried as a single file; if it needs the files, files are removed first, then lines
//   a shared build is one program with many modules, except in the mode separate-entry-points, where the compiler treats each program as it would alone
//   for two long lines that differ, the shown part starts a little before the first difference
import { expect } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { withAnotherCall } from "./fuzz/another-call-of-what-the-program-holds";
import { withFourCallers } from "./fuzz/four-callers";
import { fuzz } from "./fuzz/fuzzer";
import { withOwnCopies } from "./fuzz/own-copies";
import { Random } from "./fuzz/random";
import { reduceFiles, type Whole } from "./fuzz/reduce";
import {
  ProductRunner,
  canIsolate,
  compare,
  projects,
  spawned,
  wholeText,
  type Judged,
  type Program,
  type Runner,
} from "./fuzz/runners";
import {
  allSources,
  anotherCallSuffix,
  fourCallersSuffix,
  multiFileSuffix,
  neverTakenSuffix,
  ownCopiesSuffix,
  rewrittenSuffix,
} from "./fuzz/sources";
import { bunTypesFolder, typeChecker } from "./fuzz/type-check";
import { test as one } from "./listed";

const options = { baseFlags: [], validate: false, threads: 1, buildSeconds: 60, runSeconds: 60 };
const timeout = 300_000;
// A run that asks for a number of programs should end by that number. A slow build with other tests beside it draws few in a
// minute.
const untilTheCount = 280;
// The tests run concurrently: each has its own folders, and none waits for the clock.
const test = one.concurrent;
const unless = (condition: boolean) => (condition ? one.skip : one.concurrent);
/** A folder for one call of a runner, so that calls do not have to wait for each other. */
const within = (folder: unknown, name: string) => (
  mkdirSync(join(String(folder), name), { recursive: true }),
  join(String(folder), name)
);

// Runs programs like Bun and fails every build with the same message.
function refusesEveryBuild(folder: string, words = "TS2554: Expected 0 arguments, but got 1."): string {
  const path = join(folder, "stand-in");
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$1" in\nbuild) ls -a > seen.txt; find . -type f | sort > files.txt; echo "error: ${words}" >&2; exit 1;;\n*) exec "${bunExe()}" "$@";;\nesac\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

unless(isWindows || !typeChecker())(
  "a build rejected for a type error is a finding if TypeScript accepts the program",
  async () => {
    using folder = tempDir("aot-fuzzer-judges", {});
    const runner = new ProductRunner(refusesEveryBuild(String(folder)), options);
    let asked = 0;
    const judge = async (text: string, flags: string[] = []) =>
      (await runner.judge(within(folder, `question-${asked++}`), [{ text, extension: "ts" }], flags))[0].verdict;
    // The project's compiler options matter: with those of `bun init` an element may be undefined.
    const reads = `const list = [1];\nconst n: number = list[0];\nconsole.log(n);\n`;
    const [accepted, refused, withoutOptions, asBunInitLeavesIt, shared] = await Promise.all([
      judge(`const n: number = 1;\nconsole.log(n);\n`),
      judge(`const n: number = "text";\nconsole.log(n);\n`),
      judge(reads, ["--project=no-tsconfig"]),
      bunTypesFolder() ? judge(reads, ["--project=bun-init"]) : undefined,
      // In a shared build each program is judged separately.
      judge(`console.log(1);\n`, ["--decoy-shapes=1"]),
    ]);
    expect(accepted).toEqual({
      kind: "build refused",
      detail: "TS2554: Expected 0 arguments, but got 1. | TypeScript accepts the program",
      signature: "TSN: Expected N arguments, but got N.",
    });
    expect(refused).toEqual({ kind: "skipped", why: "type error TS2554, as in TypeScript" });
    expect(withoutOptions.kind).toBe("build refused");
    if (asBunInitLeavesIt) expect(asBunInitLeavesIt.kind).toBe("skipped");
    expect(shared.kind).toBe("build refused");
  },
  timeout,
);

unless(isWindows)(
  "an executable with correct output runs again with run-time checks on, and their report is a finding",
  async () => {
    using folder = tempDir("aot-fuzzer-second-run", {});
    // Its executables print what the program prints, and print more only if the variable is set.
    const path = join(String(folder), "stand-in");
    const executable = `#!/bin/sh\necho 1\necho run >> runs.txt\n[ -n "$BUN_JSC_validateAOTRuntime" ] && { echo "AOT: it happened, which the compiler assumed never happens" >&2; echo "AOT validation: ImpossibleMutation" >&2; exit 134; }\nexit 0\n`;
    writeFileSync(
      path,
      `#!/bin/sh\ncase "$1" in\nbuild) for last; do :; done; printf '%b' '${executable.replaceAll("\n", "\\n")}' > "$last"; chmod +x "$last";;\n*) exec "${bunExe()}" "$@";;\nesac\n`,
    );
    chmodSync(path, 0o755);
    const program = { text: `console.log(1);\n`, extension: "js" as const };
    const judged = async (name: string, more: object, flags: string[] = []) => {
      const where = within(folder, name);
      const [{ verdict }] = await new ProductRunner(path, { ...options, ...more }).judge(where, [program], flags);
      return [verdict, readFileSync(join(where, "runs.txt"), "utf8").trim().split("\n").length];
    };
    expect(await judged("twice", {})).toEqual([
      {
        kind: "validation failure",
        detail:
          "AOT validation: ImpossibleMutation | BUN_JSC_validateAOTRuntime=1 AOT: it happened, which the compiler assumed never happens",
        signature: expect.any(String),
      },
      2,
    ]);
    expect(await judged("once", { runsOnce: true })).toEqual([{ kind: "same" }, 1]);
    // A validating build already has the checks on in its first run.
    expect((await judged("validating", {}, ["--aot-validate"]))[1]).toBe(1);
  },
  timeout,
);

unless(isWindows)(
  "--project selects the project files",
  async () => {
    using folder = tempDir("aot-fuzzer-beside", {});
    const runner = new ProductRunner(refusesEveryBuild(String(folder), "it builds nothing"), options);
    const asked = Object.entries(projects).filter(([, { hasTypings }]) => !hasTypings || bunTypesFolder());
    await Promise.all(
      asked.map(async ([name, { tsconfig, hasTypings }]) => {
        const where = within(folder, name);
        await runner.judge(where, [{ text: `console.log(1);\n`, extension: "ts" }], [`--project=${name}`]);
        const files = readFileSync(join(where, "seen.txt"), "utf8").split("\n");
        expect([name, files.includes("tsconfig.json"), files.includes("node_modules")]).toEqual([
          name,
          !!tsconfig,
          !!hasTypings,
        ]);
        if (tsconfig) expect(JSON.parse(readFileSync(join(where, "tsconfig.json"), "utf8"))).toEqual(tsconfig);
        if (hasTypings) expect(existsSync(join(where, "node_modules", "@types", "bun", "index.d.ts"))).toBe(true);
      }),
    );
  },
  timeout,
);

// A runner that builds nothing: it records what it is asked and fails whatever the program's text says. A build of n
// seconds advances the test's clock by n, so nothing waits.
function standIn(judged: (programs: Program[]) => void, seconds = 0, clock = { now: 0 }): Runner {
  const run = { stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };
  return {
    name: "product",
    binary: "stand-in",
    batch: 8,
    supportsOwnBuild: true,
    accepts: () => true,
    allows: () => true,
    modes: () => [{ name: "default", flags: [] }],
    withoutFlowResults: [],
    disabling: () => [],
    switches: async () => ({ flowResults: [], passes: [] }),
    async judge(_folder, programs): Promise<Judged[]> {
      judged(programs);
      clock.now += seconds * 1000;
      return programs.map((program, index) => ({
        plain: run,
        verdict: seconds
          ? {
              kind: "different output",
              detail: `plain ${Bun.hash.crc32(program.text).toString(36).replace(/\d/g, "")} compiled x`,
              signature: `values ${index}`,
            }
          : { kind: "same" },
      }));
    },
  };
}

const settings = (folder: string) => ({
  out: join(folder, "out"),
  work: join(folder, "work"),
  programsRoot: join(import.meta.dir, "parallel"),
  known: [],
  minFreeBytes: 0,
  reduceSeconds: 0,
  attribute: false,
  firstSeed: 1,
});

test(
  "a program that must be the entry point gets its own build",
  async () => {
    using folder = tempDir("aot-fuzzer-alone", {});
    const builds: Program[][] = [];
    const summary = await fuzz({
      ...settings(String(folder)),
      runners: [{ runner: standIn(programs => builds.push(programs)), jobs: 1 }],
      sources: ["workers-terminated-midway", "number-range-boundaries"],
      seconds: untilTheCount,
      programs: 64,
    });
    const isItsOwnWorker = (program: Program) => program.text.includes("new Worker(new URL(import.meta.url)");
    expect(summary.programs).toBe(64);
    expect(builds.filter(build => build.some(isItsOwnWorker)).length).toBeGreaterThan(10);
    expect(builds.filter(build => build.some(isItsOwnWorker) && build.length > 1)).toEqual([]);
    expect(builds.some(build => build.length > 1)).toBe(true);
  },
  timeout,
);

test(
  "after the last call nothing is built again and failures are listed",
  async () => {
    using folder = tempDir("aot-fuzzer-late", {});
    let calls = 0;
    const clock = { now: 0 };
    // Every program fails with its own message, and the first build outlasts the run.
    const summary = await fuzz({
      ...settings(String(folder)),
      now: () => clock.now,
      runners: [{ runner: standIn(() => void calls++, 9, clock), jobs: 1 }],
      sources: ["number-range-boundaries"],
      seconds: 6,
      batch: 8,
    });
    const out = join(String(folder), "out");
    const listed = readFileSync(join(out, "failures.tsv"), "utf8").trim().split("\n").length;
    const notConfirmed = readFileSync(join(out, "not-confirmed.tsv"), "utf8").trim().split("\n").length;
    expect(listed).toBe(8);
    // `lastCall` is a third of the run after its end, so the one build that outlasted the run leaves nothing to
    // confirm.
    expect(notConfirmed).toBe(8);
    expect(summary.status).toContain("not confirmed 8");
    expect(readdirSync(join(out, "findings"))).toEqual([]);
    expect(calls).toBe(1);
  },
  timeout,
);

test(
  "after the last call, failures that load cannot cause are stored unreduced with their companions",
  async () => {
    using folder = tempDir("aot-fuzzer-late-stop", {});
    const clock = { now: 0 };
    const runner = standIn(() => {}, 9, clock);
    const judge = runner.judge.bind(runner);
    runner.judge = async (where, programs, flags) =>
      (await judge(where, programs, flags)).map((each, index) =>
        index
          ? { ...each, verdict: { kind: "same" as const } }
          : { ...each, verdict: { kind: "crash" as const, detail: "stopped", signature: "stopped" } },
      );
    runner.store = (where, programs) => (
      writeFileSync(join(where, "count.txt"), String(programs.length)),
      "commands\n"
    );
    await fuzz({
      ...settings(String(folder)),
      now: () => clock.now,
      runners: [{ runner, jobs: 1 }],
      sources: ["number-range-boundaries"],
      seconds: 6,
      batch: 8,
    });
    const [name, ...rest] = readdirSync(join(String(folder), "out", "findings"));
    expect(rest).toEqual([]);
    expect(name).toStartWith("crash-not-tried-again-");
    expect(readFileSync(join(String(folder), "out", "findings", name, "count.txt"), "utf8")).toBe("8");
  },
  timeout,
);

test(
  "a program that fails in plain Bun is tried in one mode only",
  async () => {
    using folder = tempDir("aot-fuzzer-plain", {});
    let judged = 0;
    const runner: Runner = {
      ...standIn(() => {}),
      batch: 1,
      modes: () => ["default", "validate", "erased"].map(name => ({ name, flags: [] })),
      judge: async (_folder, programs) =>
        programs.map(() => {
          judged++;
          return {
            plain: { stdout: "", stderr: "", exitCode: null, signal: null, timedOut: true },
            verdict: { kind: "skipped", why: "plain run too slow" },
          };
        }),
    };
    const summary = await fuzz({
      ...settings(String(folder)),
      runners: [{ runner, jobs: 1 }],
      sources: ["number-range-boundaries"],
      seconds: untilTheCount,
      programs: 8,
      batch: 1,
    });
    expect(summary.programs).toBe(8);
    expect(judged).toBe(8);
  },
  timeout,
);

// It grows to 512 MB, twice its limit, and stays there. The watcher polls every tenth of a second on this test's
// thread, and a program that grew forever would use all of the machine's memory while that thread is busy.
const holdsTwiceWhatItMay = `const kept = []; while (kept.length < 4096) kept.push(new Array(1 << 14).fill(kept.length)); for (;;);`;

// Runs programs like Bun; each of its builds grows to twice its memory limit.
function everyBuildHoldsTooMuch(folder: string): string {
  const path = join(folder, "stand-in");
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$1" in\nbuild) exec "${bunExe()}" -e '${holdsTwiceWhatItMay}';;\n*) exec "${bunExe()}" "$@";;\nesac\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

// Alone, not concurrently: nothing else may keep the thread busy that watches the memory.
one.skipIf(isWindows)(
  "a run over its memory limit is skipped, a build over it is a finding",
  async () => {
    using folder = tempDir("aot-fuzzer-judges", {});
    const runner = new ProductRunner(everyBuildHoldsTooMuch(String(folder)), { ...options, memory: 256 * 2 ** 20 });
    const judge = async (text: string) => (await runner.judge(String(folder), [{ text, extension: "js" }], []))[0];
    expect((await judge(holdsTwiceWhatItMay)).verdict).toEqual({
      kind: "skipped",
      why: "plain run takes too much memory",
    });
    const { verdict, compiled } = await judge(`console.log(1);\n`);
    expect(verdict).toEqual({ kind: "build hang", detail: "took too much memory", signature: "took too much memory" });
    expect(compiled!.build).toMatchObject({ timedOut: true, ranOutOfMemory: true, signal: null, exitCode: null });
  },
  timeout,
);

unless(isWindows)(
  "processes started by a runner exit when the fuzzer is killed",
  async () => {
    using folder = tempDir("aot-fuzzer-judges", {
      "fuzzer.ts": `import { spawned } from ${JSON.stringify(join(import.meta.dir, "fuzz", "runners"))};
await spawned([process.execPath, "-e", 'require("fs").writeFileSync("pid", String(process.pid)); setInterval(() => {}, 1000);'], import.meta.dir, 120);`,
    });
    const written = join(String(folder), "pid");
    await using fuzzer = Bun.spawn({
      cmd: [bunExe(), "fuzzer.ts"],
      cwd: String(folder),
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
    });
    while (!existsSync(written) || !readFileSync(written, "utf8")) await Bun.sleep(20);
    const pid = Number(readFileSync(written, "utf8"));
    const isAlive = () => {
      try {
        return process.kill(pid, 0);
      } catch {
        return false;
      }
    };
    try {
      expect(isAlive()).toBe(true);
      fuzzer.kill("SIGKILL");
      await fuzzer.exited;
      for (let waited = 0; isAlive() && waited < 10_000; waited += 20) await Bun.sleep(20);
      expect(isAlive()).toBe(false);
    } finally {
      if (isAlive()) process.kill(pid, "SIGKILL");
    }
  },
  timeout,
);

unless(!canIsolate())(
  "a generated program cannot signal any process but itself",
  async () => {
    using folder = tempDir("aot-fuzzer-apart", {});
    // It only signals if it is PID 1 of its own namespace: a program is never started as PID 1 anywhere else.
    const signals = `if (process.pid !== 1) process.exit(7);
for (const whom of [0, -1, ${process.pid}, ${process.ppid}]) {
  try {
    process.kill(whom, "SIGKILL");
    console.log("sent");
  } catch (error) {
    console.log(error.code);
  }
}`;
    const run = await spawned([bunExe(), "-e", signals], String(folder), 60, undefined, undefined, true);
    // Its process group is itself, and PID 1 cannot be killed from inside its namespace. There is no other process.
    const expected = [0, -1, process.pid, process.ppid].map(whom => (whom === 0 || whom === 1 ? "sent" : "ESRCH"));
    expect(run).toMatchObject({ exitCode: 0, signal: null, stdout: expected.join("\n") + "\n" });
  },
  timeout,
);

const inThreeFiles = (second: string): Program => ({
  extension: "ts",
  text: `import { twice } from "./declared-2";\nexport const one: number = 1;\nprint(String(twice(4)));\n`,
  files: {
    "declared-1.ts": `import { one } from "./main";\nexport function plusOne(n: number): number {\n  return n + one;\n}\n`,
    "declared-2.ts": second,
  },
});
const twice = `import { plusOne } from "./declared-1";\nexport function twice(n: number): number {\n  print("twice");\n  return plusOne(n) * 2;\n}\n`;

unless(isWindows || !typeChecker())(
  "a multi-file program gets its own folder and is judged as a whole",
  async () => {
    using folder = tempDir("aot-fuzzer-files", {});
    const runner = new ProductRunner(refusesEveryBuild(String(folder)), options);
    // The error is in a file that the entry point imports.
    const wrong = twice.replace("return plusOne(n) * 2", `return plusOne("n") * 2`);
    // What another version of TypeScript infers from JavaScript says nothing about the build.
    const { "declared-2.ts": typed, ...rest } = inThreeFiles(twice).files!;
    const besideJavaScript = { ...rest, "declared-2.js": typed.replaceAll(/: number/g, "") };
    const [[alone], [withAnError], [mixed], shared] = await Promise.all([
      runner.judge(within(folder, "alone"), [inThreeFiles(twice)], []),
      runner.judge(within(folder, "wrong"), [inThreeFiles(wrong)], []),
      runner.judge(within(folder, "mixed"), [{ ...inThreeFiles(twice), files: besideJavaScript }], []),
      runner.judge(
        within(folder, "shared"),
        [{ text: `console.log(1);\n`, extension: "ts" }, inThreeFiles(twice), inThreeFiles(wrong)],
        [],
      ),
    ]);
    expect(alone.plain.stdout).toBe("twice\n10\n");
    expect(
      readFileSync(join(String(folder), "alone", "files.txt"), "utf8")
        .split("\n")
        .filter(file => /^\.\/p/.test(file)),
    ).toEqual(["./program/declared-1.ts", "./program/declared-2.ts", "./program/main.ts"]);
    expect(alone.verdict.kind).toBe("build refused");
    expect(withAnError.verdict).toEqual({ kind: "skipped", why: "type error TS2554, as in TypeScript" });
    expect(mixed).toMatchObject({
      plain: { stdout: "twice\n10\n" },
      verdict: { kind: "skipped", why: "type error TS2554, beside JavaScript" },
    });
    expect(shared.map(each => each.plain.stdout)).toEqual(["1\n", "twice\n10\n", "twice\nNaN\n"]);
    expect(shared.map(each => each.verdict.kind)).toEqual(["build refused", "build refused", "skipped"]);
    // Nothing of one program is left behind for the next.
    for (const name of ["alone", "wrong", "mixed", "shared"])
      expect(readdirSync(join(String(folder), name)).filter(name => /^p(rogram$|\d)/.test(name))).toEqual([]);
  },
  timeout,
);

test("the reducer removes files first, then lines", async () => {
  const whole: Whole = {
    text: `import { a } from "./declared-1";\nimport { b, unused } from "./declared-2";\nimport { c } from "./declared-3";\nconsole.log(a());\nconsole.log(b());\nconsole.log(c());\n`,
    files: {
      "declared-1.ts": `export function a() {\n  return 1;\n}\n`,
      "declared-2.ts": `import { helper } from "./declared-4";\nexport function b() {\n  return helper() + 1;\n}\nexport function unused() {\n  return 3;\n}\n`,
      "declared-3.ts": `import { helper } from "./declared-4";\nexport function c() {\n  return helper();\n}\n`,
      "declared-4.ts": `export function helper() {\n  return 2;\n}\nexport const more = 4;\n`,
    },
  };
  const parser = new Bun.Transpiler({ loader: "ts" });
  const asked: number[] = [];
  // It fails as long as b() is called in a different file than the one that declares it, and every import resolves.
  const shows = ({ text, files = {} }: Whole) => {
    const all: Record<string, string> = { "main.ts": text, ...files };
    for (const each of Object.values(all))
      for (const [, names, from] of each.matchAll(/import\s*\{\s*([^}]*?)\s*\}\s*from\s*"\.\/([\w-]+)"/g))
        for (const name of names.split(/\s*,\s*/).filter(Boolean))
          if (!new RegExp(`export (function|const) ${name}\\b`).test(all[from + ".ts"] ?? "")) return false;
    for (const each of Object.values(all))
      for (const [, name] of each.matchAll(/\b(a|b|c|helper)\(\)(?! \{)/g))
        if (!new RegExp(`(function|[{,]) ${name}\\b`).test(each)) return false;
    return /\bb\(\)/.test(text) && !/function b\b/.test(text);
  };
  const reduced = await reduceFiles(whole, {
    entry: "main.ts",
    width: 4,
    seconds: 60,
    parses(candidate) {
      try {
        return (parser.transformSync(candidate), true);
      } catch {
        return false;
      }
    },
    fails: async candidates => (
      asked.push(...candidates.map(each => Object.keys(each.files ?? {}).length)),
      candidates.map(shows)
    ),
  });
  const dense = (text: string) => text.replace(/[\s;]/g, "");
  expect(dense(reduced.text)).toBe(`import{b}from"./declared-2"b()`);
  // Without a body it is an overload, which parses.
  expect(Object.entries(reduced.files!).map(([path, text]) => [path, dense(text)])).toEqual([
    ["declared-2.ts", "exportfunctionb()"],
  ]);
  // Candidates with fewer files come before any that only has fewer lines.
  expect(asked.slice(0, 4)).toEqual([3, 3, 3, 3]);
});

test(
  "a multi-file finding is first tried as a single file",
  async () => {
    const sources = await allSources(join(import.meta.dir, "parallel"), new Set(), true);
    const source = "number-range-boundaries-multi-file";
    // A runner that only takes single-file programs gets nothing else.
    expect(
      sources[source](
        1,
        standIn(() => {}),
      ),
    ).toBeUndefined();
    expect(Object.keys(sources[source](1, { ...standIn(() => {}), supportsMultiFile: true })!.files!)).not.toEqual([]);
    // As a module it would print a different `this`, compiled and plain, than as the script it is.
    const asksForThis = "class-definition-throws";
    const takesFiles = { ...standIn(() => {}), supportsMultiFile: true };
    expect(sources[asksForThis](54301000265, takesFiles)!.text).toContain(`show("after", this);`);
    expect(sources[asksForThis + "-multi-file"](54301000265, takesFiles)).toBeUndefined();
    const drawn = Array.from({ length: 400 }, (_, seed) => sources[source](seed, takesFiles));
    // TypeScript and JavaScript import from each other.
    const mixed = drawn
      .slice(0, 40)
      .filter(program => program && Object.keys(program.files!).some(path => path.endsWith(".js")));
    expect(mixed.length).toBeGreaterThan(4);
    // Some of the JavaScript has a declaration file, which is not one of the program's own files.
    const declared = drawn.slice(0, 200).flatMap(program =>
      Object.keys(program?.files ?? {})
        .filter(path => path.endsWith(".d.ts"))
        .map(path => [
          program!.files![path.replace(/\.d\.ts$/, ".js")] !== undefined,
          program!.files![path],
          program!.notes,
        ]),
    );
    expect(declared.length).toBeGreaterThan(4);
    for (const [isBesideJavaScript, text, notes] of declared)
      expect([isBesideJavaScript, text, notes]).toEqual([
        true,
        expect.stringContaining("export declare "),
        expect.stringContaining("beside declarations that say too little"),
      ]);
    for (const program of mixed)
      expect([program!.extension, program!.notes]).toEqual(["ts", expect.stringContaining("in JavaScript")]);
    // If a declaration file is invalid, the program's tsconfig.json turns off checking such files.
    const unchecked = drawn.filter(program => program?.files!["tsconfig.json"]);
    expect(unchecked.length).toBeGreaterThan(2);
    for (const program of unchecked) {
      expect(JSON.parse(program!.files!["tsconfig.json"]).compilerOptions).toMatchObject({
        skipLibCheck: true,
        strict: true,
      });
      expect(
        Object.entries(program!.files!)
          .filter(([path]) => path.endsWith(".d.ts"))
          .map(([, text]) => text)
          .join(""),
      ).toMatch(/Missing|Absent|NotDeclared|notDeclared|declaredTwice|InvalidRing|invalidArguments|invalidMember/);
      expect(program!.notes).toContain("under skipLibCheck");
    }
    // Some JavaScript with declarations becomes a package, and importers of the file import the package.
    const withPackages = drawn.filter(program =>
      Object.keys(program?.files ?? {}).some(path => path.startsWith("node_modules/")),
    );
    expect(withPackages.length).toBeGreaterThan(4);
    const kinds = new Set<string>();
    for (const program of withPackages) {
      const names = Object.keys(program!.files!).flatMap(
        path => /^node_modules\/([\w-]+)\/package\.json$/.exec(path)?.[1] ?? [],
      );
      for (const name of names) {
        expect(Object.keys(program!.files!)).toContain(`node_modules/${name}/index.js`);
        expect(Object.keys(program!.files!)).toContain(`node_modules/${name}/index.d.ts`);
        expect(wholeText(program!)).toContain(`from "${name}"`);
        expect(wholeText(program!)).not.toContain(`from "./${name}"`);
      }
      expect(program!.notes).toContain("as packages");
      for (const name of names) {
        const { type } = JSON.parse(program!.files![`node_modules/${name}/package.json`]);
        kinds.add(type);
        expect(/^(import|export) /m.test(program!.files![`node_modules/${name}/index.js`])).toBe(type === "module");
      }
    }
    expect([...kinds].sort()).toEqual(["commonjs", "module"]);
    // Some TypeScript has incomplete annotations, and the checker is silenced there.
    const quiet = drawn.slice(0, 200).filter(program => program?.notes.includes("under @ts-nocheck"));
    expect(quiet.length).toBeGreaterThan(4);
    for (const program of quiet)
      expect(Object.entries(program!.files!).filter(([path, text]) => path.endsWith(".ts") && text.startsWith("// @ts-nocheck\n"))).not.toEqual([]); // prettier-ignore
    // Some entry points import through a file that only re-exports what the others export.
    const barrels = drawn.slice(0, 60).filter(program => program?.files!["barrel.ts"]);
    expect(barrels.length).toBeGreaterThan(4);
    for (const program of barrels) {
      expect(program!.text).toContain(`from "./barrel";`);
      expect(program!.text).not.toMatch(/from "\.\/declared-/);
      expect(program!.files!["barrel.ts"]).toMatch(/^(export (\*|(type )?\{[^}]*\}) from "(\.\/)?declared-\d+";\n)+$/);
    }
    // The smallest of them with three or more files is the one that is reduced.
    const firstSeed = drawn.reduce(
      (best, program, seed) =>
        program &&
        Object.keys(program.files!).length > 2 &&
        (best < 0 || wholeText(program).length < wholeText(drawn[best]!).length)
          ? seed
          : best,
      -1,
    );
    const stored = async (fails: (program: Program) => boolean) => {
      using folder = tempDir("aot-fuzzer-files-first", {});
      const runner = { ...standIn(() => {}), supportsMultiFile: true };
      const judge = runner.judge.bind(runner);
      runner.judge = async (where, programs, flags) =>
        (await judge(where, programs, flags)).map((each, index) =>
          fails(programs[index])
            ? { ...each, verdict: { kind: "crash" as const, detail: "stopped", signature: "stopped" } }
            : each,
        );
      await fuzz({
        ...settings(String(folder)),
        runners: [{ runner, jobs: 1 }],
        sources: [source],
        firstSeed,
        seconds: untilTheCount,
        programs: 1,
        batch: 1,
        reduceSeconds: 20,
      });
      const [name, ...rest] = readdirSync(join(String(folder), "out", "findings"));
      expect(rest).toEqual([]);
      const finding = join(String(folder), "out", "findings", name);
      return {
        files: readdirSync(finding).sort(),
        reduced: existsSync(join(finding, "reduced")) ? readdirSync(join(finding, "reduced")).sort() : [],
        original: readdirSync(join(finding, "original")).length,
        ...JSON.parse(readFileSync(join(finding, "finding.json"), "utf8")),
      };
    };
    const [anywhere, acrossFiles] = await Promise.all([
      stored(() => true),
      stored(program => Object.keys(program.files ?? {}).length > 0),
    ]);
    expect(anywhere).toMatchObject({ source, failsAsSingleFile: true, reduced: [] });
    expect(anywhere.files).toContain("reduced.ts");
    expect(anywhere.original).toBeGreaterThan(1);
    expect(acrossFiles).toMatchObject({ source, failsAsSingleFile: false });
    expect(acrossFiles.reduced).toContain("main.ts");
    expect(acrossFiles.reduced.length).toBe(2);
  },
  timeout,
);

test(
  "in separate-entry-points mode each program of a shared build is compiled as its own program",
  async () => {
    using folder = tempDir("aot-fuzzer-each-a-program", {});
    const runner = new ProductRunner(bunExe(), options);
    const programs: Program[] = [
      { text: `console.log("first", [1, 2].length);\n`, extension: "js" },
      { text: `const n: number = 2;\nconsole.log("second", n);\n`, extension: "ts" },
      { text: `import { third } from "./other";\nconsole.log(third);\nprocess.exitCode = 3;\n`, extension: "ts", files: { "other.ts": `export const third = "third";\n` } }, // prettier-ignore
    ];
    const runsOfTheCompiler = async (name: string) => {
      const { flags } = runner.modes(programs[0]).find(mode => mode.name === name)!;
      const judged = await runner.judge(within(folder, name), programs, [...flags, "--aot-report=report.json"]);
      expect(judged.map(({ verdict }) => verdict.kind)).toEqual(["same", "same", "same"]);
      expect(judged.map(({ compiled }) => [compiled!.run!.stdout.trim(), compiled!.run!.exitCode])).toEqual([["first 2", 0], ["second 2", 0], ["third", 3]]); // prettier-ignore
      return JSON.parse(readFileSync(join(String(folder), name, "report.json"), "utf8")).statistics.EngineRuns;
    };
    // One more for the file that starts them.
    expect(await Promise.all([runsOfTheCompiler("default"), runsOfTheCompiler("separate-entry-points")])).toEqual([
      1,
      programs.length + 1,
    ]);
  },
  timeout,
);

test("for two long lines that differ, the shown part starts a little before the first difference", () => {
  const ran = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signal: null, timedOut: false });
  const detail = (plain: string, compiled: string) => {
    const verdict = compare(
      standIn(() => {}),
      { text: "", extension: "js" },
      ran(plain),
      { build: ran(""), run: ran(compiled) },
    );
    return verdict.kind === "different output" ? verdict.detail : verdict.kind;
  };
  const alike = "x".repeat(300);
  expect(detail(`first\n${alike}one tail\n`, `first\n${alike}another tail\n`)).toBe(
    `at character 300 of the line plain "..${"x".repeat(40)}one tail" compiled "..${"x".repeat(40)}another tail"`,
  );
  expect(detail(`${alike}\n`, `${alike}more\n`)).toBe(
    `at character 300 of the line plain "..${"x".repeat(40)}" compiled "..${"x".repeat(40)}more"`,
  );
  expect(detail("a 1\n", "a 2\n")).toBe(`plain "a 1" compiled "a 2"`);
  expect(detail("a\n", "a\nb\n")).toBe(`plain "" compiled "b"`);
});

test(
  "an accepted difference also matches in a long line",
  async () => {
    using folder = tempDir("aot-fuzzer-long-line", {});
    const run = { stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };
    const detail = `at character 121 of the line plain "..| string \\"class C {" compiled "..| string \\"class C { static n = 0; }"`;
    const summary = await fuzz({
      ...settings(String(folder)),
      known: [join(import.meta.dir, "fuzz", "accepted-differences.tsv")],
      runners: [
        {
          runner: {
            ...standIn(() => {}),
            judge: async (_folder, programs) =>
              programs.map(() => ({
                plain: run,
                verdict: { kind: "different output", detail, signature: "values a b" },
              })),
          },
          jobs: 1,
        },
      ],
      sources: ["number-range-boundaries"],
      seconds: untilTheCount,
      programs: 8,
    });
    expect(summary.status).toContain("findings 8: known 8,");
  },
  timeout,
);

// Alone, after the others: it loads every generator, and their data makes each collection slower.
one.skipIf(isWindows)(
  "every source makes a program",
  async () => {
    const sources = await allSources(join(import.meta.dir, "parallel"), new Set(), true);
    const runner = { ...standIn(() => {}), supportsMultiFile: true };
    const startPython = ["by-python", "scripted-cases"];
    const asked = Object.keys(sources).filter(
      name =>
        !startPython.includes(name) &&
        !name.endsWith(multiFileSuffix) &&
        !name.endsWith(rewrittenSuffix) &&
        !name.endsWith(neverTakenSuffix) &&
        !name.endsWith(anotherCallSuffix) &&
        !name.endsWith(ownCopiesSuffix) &&
        !name.endsWith(fourCallersSuffix),
    );
    expect(asked.length).toBeGreaterThan(300);
    const seeds = Array.from({ length: 24 }, (_, seed) => seed);
    expect(asked.filter(name => !seeds.some(seed => sources[name](seed, runner)))).toEqual([]);
  },
  timeout,
);

test("what a program does at its top is done by four callers", () => {
  const text = `const seen = [];
function f(z) {
  seen.push(z);
  return z;
}
const g = z => f(z) + 1;
const list = [1, 2];
f(list[0]);
console.log(g(list[1]), seen.join());
`;
  const body = `const list = [1, 2];\nf(list[0]);\nconsole.log(g(list[1]), seen.join());\n}`;
  expect(withFourCallers("program.js", text)).toBe(`const seen = [];
function f(z) {
  seen.push(z);
  return z;
}
const g = z => f(z) + 1;
function driveA() {
${body}
function driveB() {
${body}
function driveC() {
${body}
function driveD() {
${body}
for (let round = 0; round < 2; round++) {
  driveA();
  driveB();
  driveC();
  driveD();
}
`);
  const waits = withFourCallers("program.js", `function f() {}\nawait f();\nconst driveA = 1;\nf(driveA);\n`)!;
  expect(waits).toStartWith("function f() {}\nawait f();\nfunction driveA_() {\nconst driveA = 1;\nf(driveA);\n}");
  expect(withFourCallers("program.js", "function f() {}\nawait f();\n")).toBeUndefined();
  expect(withFourCallers("program.js", "function f() {}\nawait (f());\nconst x = await [f()][0];\n")).toBeUndefined();
});

test("each user of a shared function or class gets a copy of its own", () => {
  const text = `function same(x) {
  return x;
}
class Box {
  v = 1;
}
function one() {
  return same(new Box().v);
}
function two(same) {
  return same;
}
function three() {
  const held = { same };
  return held.same(2) + new Box().v;
}
console.log(one(), two(3), three());
`;
  const written = Array.from({ length: 40 }, (_, seed) => withOwnCopies("program.js", text, new Random(seed)) ?? "");
  const whole = written.find(text => text.includes("function same_2(x)") && text.includes("class Box_2 {"))!;
  expect(whole).toContain("const held = { same: same_2 };\n  return held.same(2) + new Box_2().v;");
  expect(whole).toContain("function one() {\n  return same(new Box().v);\n}");
  expect(written.filter(text => text && !text.includes("function two(same) {\n  return same;\n}"))).toEqual([]);
  const alone = "function f() {\n  return 1;\n}\nconsole.log(f());\n";
  expect(Array.from({ length: 40 }, (_, seed) => withOwnCopies("program.js", alone, new Random(seed)))).toEqual(
    Array(40).fill(undefined),
  );
});

test("another call brings no import statement into a text that names what only a CommonJS file has", () => {
  const written = (test: string) =>
    Array.from({ length: 40 }, (_, seed) => {
      const text = `function f(a) {\n  return ${test} ? a : 0;\n}\nconsole.log(f(1));\n`;
      return withAnotherCall("program.js", text, new Random(seed)) ?? "";
    });
  expect(written("a > 0").some(text => text.startsWith("import "))).toBe(true);
  expect(written(`typeof module === "object"`).filter(text => text.startsWith("import "))).toEqual([]);
  expect(written(`typeof module === "object"`).every(text => text.includes("try {\n  f("))).toBe(true);
});

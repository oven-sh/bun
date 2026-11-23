// The cases of a test file as the test files of one project, which is run once for each way of running it.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "../supported";
import { run } from "./run";

export type CaseOfRun = {
  /** "pass" or "fail". Undefined: the run did not come to it. */
  result: string | undefined;
  /** What the case printed through `say`. */
  printed: string;
};

/** The arguments of `ran`. */
export type Way = [flags: string[], words?: string];

/**
 * `ways`: each gets a case of its own ahead of the cases that read it. Else the first of them waits for every run, one after another, in the time of one case.
 * `declare`: the `test` of the file, where that is not the one of ../supported.
 */
export function casesOfOneRun(
  name: string,
  shared: Record<string, string> = {},
  ways: Way[] = [],
  declare: typeof test = test,
) {
  const files: Record<string, string> = { ...shared };
  const runs = new Map<string, Promise<Map<string, CaseOfRun>>>();
  let count = 0;
  let folder: ReturnType<typeof tempDir> | undefined;
  afterAll(() => folder?.[Symbol.dispose]());
  for (const [flags, words] of ways)
    declare(`${name} runs: ${[...flags, words].filter(Boolean).join(" ") || "plain"}`, async () => {
      expect((await ran(flags, words)).size).toBeGreaterThan(0);
    });

  /**
   * Adds a folder with a test file and what it imports. `testFile` gets the name of the case: its one test has that name, and what
   * it prints goes through `say`, which `sayOf(name)` declares. Every case is added before the first run.
   */
  function add(testFile: (name: string) => string, others: Record<string, string> = {}) {
    if (folder) throw new Error("the project has run already");
    const id = `c${String(++count).padStart(2, "0")}`;
    files[`${id}/case.test.js`] = testFile(id);
    for (const [path, text] of Object.entries(others)) files[`${id}/${path}`] = text;
    return id;
  }

  /** `bun test --isolate <flags>` in the project, once for each list of arguments. */
  function ran(flags: string[] = [], words?: string) {
    return runs.getOrInsertComputed(JSON.stringify([flags, words]), async () => {
      folder ??= tempDir(name, files);
      const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(folder), env);
      // A crash prints only there.
      if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
      const cases = new Map<string, CaseOfRun>();
      const of = (id: string) => cases.getOrInsertComputed(id, () => ({ result: undefined, printed: "" }));
      for (const [, result, id] of stderr.matchAll(/^\((pass|fail)\) (c\d+)(?: \[.*\])?$/gm)) of(id).result = result;
      let last: CaseOfRun | undefined;
      for (const line of stdout.split("\n")) {
        const [, id, text] = line.match(/^(c\d+)\| ?(.*)$/) ?? [];
        if (id) (last = of(id)).printed += text + "\n";
        else if (last && line) last.printed += line + "\n";
      }
      return cases;
    });
  }

  return { add, ran };
}

export const sayOf = (name: string) => `const say = (...all) => console.log("${name}|", ...all);`;

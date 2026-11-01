import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { run } from "./run";

// A layered test run has three images in one realm: the packages with Bun's library, what else the test files import, and the test files.
// Here classes, closures, objects with typed fields, errors, iterators, proxies, modules and the library's own state go from each to the others, each body seven times.
// A check prints what it saw, so a wrong value shows where no `expect` asks for it. The files are packages and test files only in the copy that is run.
const folder = join(import.meta.dir, "..", "three-layers");
const files = Object.fromEntries(
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .map(path => [
      path
        .slice(folder.length + 1)
        .replaceAll("\\", "/")
        .replace(/^packages\//, "node_modules/")
        .replace(/^tests\/(.*)\.fixture\./, "test/$1.test."),
      readFileSync(path, "utf8"),
    ]),
);

async function seenIn(words: string | undefined, flags: string[] = [], more: Record<string, string> = {}) {
  using dir = tempDir("aot-three-layers", files);
  // Not CI: each run writes the snapshot that it is held to.
  const env = { ...bunEnv, CI: "false", BUN_DEBUG_TEST_AOT_WORDS: words, ...more };
  // Several runs at once: on a busy machine a check that waits for a file watcher has passed the five seconds that a test has.
  const command = [bunExe(), "test", "--isolate", "--timeout=60000", ...flags];
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("RESULT|"));
  return { seen: seen.sort(), failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic/.test(line)), exitCode };
}

type Way = { words?: string; env?: Record<string, string> };

/**
 * Every way is a compiled run of the whole project, held to a plain run. Under a sanitizer the builds of one way take minutes of
 * processor time, so the ways are dealt to several test files, and each file makes the plain run for itself.
 */
export function answerAsPlainBunTest(ways: Record<string, Way>) {
  test(`three layers answer as plain bun test: ${Object.keys(ways).join(", ")}`, async () => {
    const [plain, ...compiled] = await Promise.all([
      seenIn(undefined),
      ...Object.values(ways).map(({ words, env }) => seenIn(words, ["--aot"], env)),
    ]);
    expect(plain.seen.length).toBeGreaterThan(320);
    expect(plain.failed).toEqual([]);
    for (const [index, way] of Object.keys(ways).entries())
      expect({ way, ...compiled[index] }).toEqual({ way, ...plain });
  }, 240_000);
}

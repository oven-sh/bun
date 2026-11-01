import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { beforeAll, testOneByOne as test } from "../supported";
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

// What a run that was stopped says of it. Without these lines an abort reads "exitCode 134" and a result that is missing.
const stop =
  /ASSERTION FAILED|Unchecked JS exception|This scope can throw|unchecked as of this scope|AddressSanitizer|LeakSanitizer|panic[:(]|Segmentation fault/;

async function seenIn(words: string | undefined, flags: string[] = [], more: Record<string, string> = {}) {
  using dir = tempDir("aot-three-layers", files);
  // Not CI: each run writes the snapshot that it is held to.
  const env = { ...bunEnv, CI: "false", BUN_DEBUG_TEST_AOT_WORDS: words, ...more };
  // Several runs at once: on a busy machine a check that waits for a file watcher has passed the five seconds that a test has.
  const command = [bunExe(), "test", "--isolate", "--timeout=60000", ...flags];
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("RESULT|"));
  const said = stderr.split("\n");
  const failed = said.filter(line => /^\(fail\)|^✗|^panic/.test(line));
  const stopped = said.filter(line => stop.test(line)).map(line => line.trim());
  return { seen: seen.sort(), failed, stopped: stopped.slice(0, 12), exitCode };
}

type Way = { words?: string; env?: Record<string, string> };

/**
 * Every way is a compiled run of the whole project, held to a plain run. Under a sanitizer the builds of one way take minutes of
 * processor time, so the ways are dealt to several test files, and each file makes the plain run for itself.
 */
export function answerAsPlainBunTest(ways: Record<string, Way>) {
  let plain: Awaited<ReturnType<typeof seenIn>>;
  beforeAll(async () => {
    plain = await seenIn(undefined);
  });

  test("plain bun test answers", () => {
    expect(plain.seen.length).toBeGreaterThan(320);
    expect(plain.failed).toEqual([]);
  });

  test.each(Object.entries(ways))("three layers answer as plain bun test: %s", async (way, { words, env }) => {
    const compiled = await seenIn(words, ["--aot"], env);
    if (compiled.stopped.length) console.error(`${way}: the run was stopped:\n${compiled.stopped.join("\n")}`);
    expect(compiled).toEqual(plain);
  });
}

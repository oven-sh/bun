import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `date.toJSON()` calls the toISOString that it finds, `list.toString()` the join, `/b+/.test(text)` the exec, `a.isSubsetOf(b)` the has of b, `promise.catch(f)` the then.
// Native code looks each of them up by name, so a test that replaces, spies on or mocks the member sees the call, whatever compiled code knows of the object.
// Each file of the folder is a test file of its own, built alone.
const folder = join(import.meta.dir, "natives-find-what-tests-replace");

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

for (const file of readdirSync(folder).sort()) {
  test(file.replace(/\.fixture\.[jt]s$/, ""), async () => {
    using dir = tempDir("natives-find-what-tests-replace", { [file.endsWith(".ts") ? "one.test.ts" : "one.test.js"]: readFileSync(join(folder, file), "utf8") });
    const plain = await runTests(String(dir));
    expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
    expect(plain.results).not.toEqual([]);
    expect(await runTests(String(dir), "--aot")).toEqual(plain);
  });
}

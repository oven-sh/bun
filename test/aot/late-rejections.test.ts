import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(300_000);

// A test lets a promise float, and it rejects on another thread's word. `bun test` does not wait for it: the run is red only if the answer is there when the
// file's last test ends. A compiled test is faster, so the answer has less time. Given the same time, a compiled run sees what `bun test` sees.
const goesOn = `const end = performance.now() + 100; while (performance.now() < end);`;
const fromFs: Record<string, string> = {
  access: `access("a")`,
  appendFile: `appendFile("no/a", "")`,
  chmod: `chmod("a", 0o600)`,
  copyFile: `copyFile("a", "b")`,
  link: `link("a", "b")`,
  lstat: `lstat("a")`,
  mkdir: `mkdir("no/a")`,
  open: `open("a")`,
  opendir: `opendir("a")`,
  readFile: `readFile("a")`,
  readdir: `readdir("a")`,
  readlink: `readlink("a")`,
  realpath: `realpath("a")`,
  rename: `rename("a", "b")`,
  rmdir: `rmdir("a")`,
  stat: `stat("a")`,
  truncate: `truncate("a")`,
  unlink: `unlink("a")`,
  utimes: `utimes("a", 1, 1)`,
};
// On Windows chown() does nothing and succeeds, and a refused connection is tried again for a second or two.
if (!isWindows) fromFs.chown = `chown("a", 1, 1)`;
const seen: Record<string, string> = { ...fromFs, ...(isWindows ? {} : { fetch: `fetch("http://127.0.0.1:1/")` }) };
// The runner leaves before it turns to these.
const unseen: Record<string, string> = {
  "timer-rejects": `setTimeout(() => Promise.reject(new Error("late")), 1)`,
  "timer-throws": `setTimeout(() => { throw new Error("late"); }, 1)`,
  worker: `new Worker("data:text/javascript,throw new Error('late')")`,
};
const fileOf = (name: string, call: string, then: string) => `import { test } from "bun:test";
${name in fromFs ? `import { ${name} } from "node:fs/promises";` : ""}
test("t", () => { ${call}; ${then} });`;

async function filesWithError(cwd: string, flags: string[], words = "") {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], cwd, {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_DEBUG_TEST_AOT_WORDS: words,
  });
  const withError: string[] = [];
  let file = "";
  for (const line of (stdout + "\n" + stderr).split("\n")) {
    file = /^(\S+)\.test\.mjs:$/.exec(line)?.[1] ?? file;
    if (line === "# Unhandled error between tests") withError.push(file);
  }
  return { withError: withError.sort(), exitCode };
}
const forms: [string, string][] = [
  ["as one program", "TestRunLayers:0"],
  ["in two layers", "TestRunLayers:2,TestRunPartFiles:1"],
];

test.each(forms)("an answer that is there when the last test ends is an error of its file, %s", async (_, words) => {
  const files = Object.entries(seen).map(([name, call]) => [`${name}.test.mjs`, fileOf(name, call, goesOn)]);
  using dir = tempDir("aot-late-rejections", { "package.json": `{ "name": "p" }`, ...Object.fromEntries(files) });
  const plain = await filesWithError(String(dir), []);
  expect(plain).toEqual({ withError: Object.keys(seen).sort(), exitCode: 1 });
  expect(await filesWithError(String(dir), ["--aot"], words)).toEqual(plain);
});

test.each(Object.entries(unseen))("nobody turns to %s behind the last test", async (name, call) => {
  using dir = tempDir("aot-late-rejections", {
    "package.json": `{ "name": "p" }`,
    [`${name}.test.mjs`]: fileOf(name, call, goesOn),
  });
  const plain = await filesWithError(String(dir), []);
  expect(plain).toEqual({ withError: [], exitCode: 0 });
  expect(await filesWithError(String(dir), ["--aot"])).toEqual(plain);
});

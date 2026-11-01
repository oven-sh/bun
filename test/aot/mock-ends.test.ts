import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all, filesOf } from "./harness/mock-sequences";
import { run } from "./harness/run";
import { test } from "./supported";

// The mocks of a test file end with it, and what says whether they did is the NEXT file. Every sequence of harness/mock-sequences.ts in one project, each followed by
// a test file that mocks nothing and looks: what import(), require(), a user that the first file loaded and a user linked at its own top see. One realm, the files named
// in order on the command line: `bun test <folder>` runs them as the file system lists them. What `bun test` prints there is the specification.
// mock-ends.known.txt holds what differs, a line `<way> <sequence> <what is asked>: <loud | SILENT> | <what is printed>`: a line that is cured, one that changes and a new
// one all fail. BUN_AOT_REWRITE_MOCK_ENDS=1 writes the list anew.
// Behind the first vi.resetModules() of a realm every file that has run is left to the host, for all later test files: what stood behind it would be judged on the
// interpreter. So the sequences that reset come last.
const ordered = [...all].sort((a, b) => Number(a.steps.includes("reset")) - Number(b.steps.includes("reset")));
const files = Object.assign(
  { "package.json": `{ "type": "module" }` },
  ...ordered.map(sequence => filesOf(sequence, 0, true)),
);
const inOrder = ordered.flatMap(({ id }) => [`./test/${id}.test.js`, `./test/${id}.test.next.test.js`]);
const list = join(import.meta.dir, "mock-ends.known.txt");
const known = readFileSync(list, "utf8").split("\n");
const ways: Record<string, string> = { "one-program": "TestRunLayers:0", "two-layers": "TestRunLayers:2" };

async function seenByNextFiles(dir: string, words?: string) {
  const env = { ...bunEnv, NO_COLOR: "1", ...(words && { BUN_DEBUG_TEST_AOT_WORDS: words }) };
  const { stdout, stderr } = await run(
    [bunExe(), "test", "--no-isolate", ...(words ? ["--aot"] : []), ...inOrder],
    dir,
    env,
  );
  const lines = new Map<string, string>();
  let order = "";
  for (const line of (stdout + "\n" + stderr).split("\n")) {
    const found = line.match(/^\| (\S+) (\d) \S+ (values|names): (.*)$/);
    if (found?.[2] === "8") lines.set(`${found[1]} ${found[3]}`, found[4]);
    // A next file that ran ahead of its sequence would judge something else.
    if (found) order += found[2] === "8" ? "n" : "m";
  }
  expect(order.startsWith("n")).toBe(false);
  return lines;
}

const found: string[] = [];
for (const [way, words] of Object.entries(ways)) {
  test(`what the next file sees: ${way}`, async () => {
    using dir = tempDir("aot-mock-ends", files);
    const [plain, compiled] = [await seenByNextFiles(String(dir)), await seenByNextFiles(String(dir), words)];
    expect(plain.size).toBe(all.length * 2);
    const differing = [...plain]
      .filter(([key, expected]) => compiled.get(key) !== expected)
      .map(([key]) => {
        const got = compiled.get(key) ?? "nothing";
        return `${way} ${key}: ${/threw |nothing/.test(got) ? "loud" : "SILENT"} | ${got}`;
      })
      .sort();
    found.push(...differing);
    if (process.env.BUN_AOT_REWRITE_MOCK_ENDS) {
      writeFileSync(list, [...known.filter(line => line.startsWith("#")), ...found, ""].join("\n"));
      return;
    }
    expect(differing).toEqual(known.filter(line => line.startsWith(way + " ")));
  }, 600_000);
}

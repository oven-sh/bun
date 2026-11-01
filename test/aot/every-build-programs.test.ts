// run-parallel.ts says what parallel/every-build.txt is for.
import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "parallel");
const lines = readFileSync(join(root, "every-build.txt"), "utf8")
  .split("\n")
  .filter(line => line && !line.startsWith("#"));

test("each line names a program or a folder that is there, once, in order", () => {
  const isThere = (line: string) => {
    const found = statSync(join(root, line), { throwIfNoEntry: false });
    return line.endsWith("/") ? found?.isDirectory() : found?.isFile();
  };
  expect(lines.filter(line => !isThere(line))).toEqual([]);
  expect(lines).toEqual([...new Set(lines)].sort());
});

// every-build.txt counts eight minutes of one processor for them. Whoever adds a program takes another one off.
test("no more programs than were measured", () => {
  expect(lines.length).toBeLessThanOrEqual(720);
});

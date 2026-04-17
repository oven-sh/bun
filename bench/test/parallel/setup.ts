// Generates N test files that each do a bit of real work, so the suite is
// dominated by per-file execution time rather than startup. This is the shape
// where --parallel wins: independent files, roughly equal duration.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const FILES = 32;
const TESTS_PER_FILE = 4;
const dir = import.meta.dir + "/suite";

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

for (let f = 0; f < FILES; f++) {
  let body = "";
  for (let t = 0; t < TESTS_PER_FILE; t++) {
    body += `
test("file${f}-t${t}", async () => {
  // Mix of I/O wait and a little CPU so neither dominates.
  await new Promise(r => setTimeout(r, 25));
  let h = 0;
  for (let i = 0; i < 50_000; i++) h = (h * 31 + i) | 0;
  expect(typeof h).toBe("number");
});
`;
  }
  writeFileSync(`${dir}/file${String(f).padStart(2, "0")}.test.ts`, body);
}

console.log(`wrote ${FILES} files × ${TESTS_PER_FILE} tests to ${dir}`);

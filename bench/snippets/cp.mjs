import { mkdirSync, rmSync, writeFileSync } from "fs";
import { cp } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { bench, run } from "../runner.mjs";

import { fileURLToPath } from "url";
const hugeDirectory = (() => {
  const root = join(tmpdir(), "huge");
  const base = join(root, "directory", "for", "benchmarks", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10");
  mkdirSync(base, {
    recursive: true,
  });
  for (let i = 0; i < 1000; i++) {
    writeFileSync(join(base, "file-" + i + ".txt"), "Hello, world! " + i);
  }
  return root;
})();
const hugeFilePath = join(tmpdir(), "huge-file-0.txt");
const hugeText = "Hello, world!".repeat(1000000);
writeFileSync(hugeFilePath, hugeText);
let base = process.argv.at(-1);
if (resolve(base) === fileURLToPath(import.meta.url)) {
  base = tmpdir();
} else {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
}

var hugeCopyI = 0;
bench("cp -r (1000 files)", async b => {
  await cp(hugeDirectory, join(base, "huge-copy" + hugeCopyI++), { recursive: true });
});

bench("cp 1 " + ((hugeText.length / 1024) | 0) + " KB file", async b => {
  await cp(hugeFilePath, join(base, "huge-file" + hugeCopyI++));
});

await run();

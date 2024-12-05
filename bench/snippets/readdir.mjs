import { createHash } from "crypto";
import { readdirSync } from "fs";
import { readdir } from "fs/promises";
import { relative, resolve } from "path";
import { argv } from "process";
import { fileURLToPath } from "url";
import { bench, run } from "../runner.mjs";

let dir = resolve(argv.length > 2 ? argv[2] : fileURLToPath(new URL("../../node_modules", import.meta.url)));
if (dir.includes(process.cwd())) {
  dir = relative(process.cwd(), dir);
}

const result = await readdir(dir, { recursive: true });
const count = result.length;
const syncCount = readdirSync(dir, { recursive: true }).length;

const hash = createHash("sha256").update(result.sort().join("\n")).digest("hex");

bench(`await readdir("${dir}", {recursive: true})`, async () => {
  await readdir(dir, { recursive: true });
});

bench(`await readdir("${dir}", {recursive: true}) x 10`, async () => {
  const promises = [
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
    readdir(dir, { recursive: true }),
  ];
  await Promise.all(promises);
});

bench(`await readdir("${dir}", {recursive: false})`, async () => {
  await readdir(dir, { recursive: false });
});

await run();

if (!process?.env?.BENCHMARK_RUNNER) {
  console.log("\n", count, "files/dirs in", dir, "\n", "SHA256:", hash, "\n");

  if (count !== syncCount) {
    throw new Error(`Mismatched file counts: ${count} async !== ${syncCount} sync`);
  }
}

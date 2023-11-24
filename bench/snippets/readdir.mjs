import { readdirSync, readdir as readdirCb } from "fs";
import { readdir } from "fs/promises";
import { bench, run } from "./runner.mjs";
import { argv } from "process";
import { fileURLToPath } from "url";
import { relative, resolve } from "path";

let dir = resolve(argv.length > 2 ? argv[2] : fileURLToPath(new URL("../../node_modules", import.meta.url)));
if (dir.includes(process.cwd())) {
  dir = relative(process.cwd(), dir);
}

const result = await readdir(dir, { recursive: true });
const count = result.length;
const syncCount = readdirSync(dir, { recursive: true }).length;

bench(`await readdir("${dir}", {recursive: true})`, async () => {
  await readdir(dir, { recursive: true });
});

bench(`await readdir("${dir}", {recursive: false})`, async () => {
  await readdir(dir, { recursive: false });
});

await run();
console.log("\n", count, "files/dirs in", dir);

if (count !== syncCount) {
  throw new Error(`Mismatched file counts: ${count} async !== ${syncCount} sync`);
}

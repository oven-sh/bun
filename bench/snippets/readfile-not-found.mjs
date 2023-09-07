import { bench, run } from "./runner.mjs";
import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

bench(`readFileSync(/tmp/404-not-found)`, () => {
  try {
    readFileSync("/tmp/404-not-found");
  } catch (e) {}
});

bench(`readFile(/tmp/404-not-found)`, async () => {
  try {
    await readFile("/tmp/404-not-found");
  } catch (e) {}
});

await run();

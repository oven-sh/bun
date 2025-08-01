import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { bench, run } from "../runner.mjs";

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

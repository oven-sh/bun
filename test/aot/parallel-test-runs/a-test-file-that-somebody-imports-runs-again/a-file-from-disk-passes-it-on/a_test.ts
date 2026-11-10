import { test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export * from "./sides.mjs?one";
const kept = globalThis as unknown as { turn?: number };
test("a file that the test writes passes the names of this file on in each run", async () => {
  const turn = (kept.turn = (kept.turn ?? 0) + 1);
  const folder = join(import.meta.dir, "written");
  mkdirSync(folder, { recursive: true });
  if (turn === 1) writeFileSync(join(folder, "owner.mjs"), 'export * from "../a_test.ts";');
  writeFileSync(join(folder, "reader-" + turn + ".mjs"), 'import { height, width } from "./owner.mjs"; export const sum = width + height;');
  const { sum } = await import(join(folder, "reader-" + turn + ".mjs"));
  console.log("SAID " + turn + " " + sum);
});

import { test } from "bun:test";
export * from "./sides.mjs";
const kept = globalThis as unknown as { turn?: number };
test("the file that imports this one finds its names in each run", async () => {
  const turn = (kept.turn = (kept.turn ?? 0) + 1);
  const { sum } = await import("./area.ts");
  console.log("SAID " + turn + " " + sum);
});

import { test } from "bun:test";
import { ran } from "./log.ts";
test("nothing of the graph runs", async () => {
  let outcome: string = "loaded";
  try {
    await import("./panel.ts");
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(outcome, "|", ran.join() || "nothing ran");
});

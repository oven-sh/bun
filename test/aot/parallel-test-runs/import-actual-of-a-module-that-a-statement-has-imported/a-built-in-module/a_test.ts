import { test, vi } from "bun:test";
import * as part from "node:os";

async function turnsOf(load: Promise<unknown>) {
  let isDone = false;
  let turns = 0;
  load.then(() => {
    isDone = true;
  });
  while (!isDone && turns < 100) {
    await null;
    turns++;
  }
  return turns;
}

test("the first takes as many turns as the second", async () => {
  console.log(typeof part, await turnsOf(vi.importActual("node:os")), await turnsOf(vi.importActual("node:os")));
});

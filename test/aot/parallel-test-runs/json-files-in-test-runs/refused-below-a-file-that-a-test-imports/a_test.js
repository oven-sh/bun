import { test } from "bun:test";
test("the load fails twice alike", async () => {
  for (const turn of [1, 2]) {
    try {
      console.log(turn, "loaded", JSON.stringify((await import("./holder.js")).held));
    } catch (error) {
      console.log(turn, error.name + ": " + error.message);
    }
  }
});

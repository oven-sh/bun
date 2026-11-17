import { test, vi } from "bun:test";
vi.mock("wick", async original => ({ ...(await original()), held: 2 }));
test("a name of two stars is none", async () => {
  const all = await import("wick");
  console.log("SAID", Object.keys(all).sort().join(), "round" in all, all.only, all.held);
  console.log("SAID", (await import("./reader.mjs")).seen());
  let round;
  try {
    round = all.round;
  } catch (error) {
    round = error.message.slice(0, 10);
  }
  console.log("SAID", round);
});

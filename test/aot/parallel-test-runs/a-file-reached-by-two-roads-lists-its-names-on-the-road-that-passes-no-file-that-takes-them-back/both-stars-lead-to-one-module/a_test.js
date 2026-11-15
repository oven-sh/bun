import { test, vi } from "bun:test";
test("who has the name", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  const say = async (what, load) => {
    try {
      console.log("SAID", what, String((await load()).look()));
    } catch (error) {
      console.log("SAID", what, error.name);
    }
  };
  await say("wide.round", () => import("./reader0.mjs"));
});
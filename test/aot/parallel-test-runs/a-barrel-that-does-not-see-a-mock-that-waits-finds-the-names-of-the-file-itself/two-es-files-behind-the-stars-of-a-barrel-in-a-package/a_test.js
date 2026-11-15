import { test, vi } from "bun:test";
const say = async (what, load) => {
  let said;
  try {
    said = (await load()).look();
  } catch (error) {
    said = error.name;
  }
  console.log("SAID", what, said);
};
test("the namespace and the name", async () => {
  vi.doMock("pack/shapes.mjs", () => ({ round: 10 }));
  await say("the namespace", () => import("./whole.mjs"));
  await say("the name", () => import("./named.mjs"));
});

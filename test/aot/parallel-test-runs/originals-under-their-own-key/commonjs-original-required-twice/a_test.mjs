import { beforeEach, test, vi } from "bun:test";
beforeEach(() => {
  vi.mock("./leaf.cjs", async original => ({ ...(await original()), tag: "mock" }));
});
const say = () => console.log("SAID", require("./leaf.cjs").tag);
test("first", say);
test("second", say);

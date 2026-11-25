import { afterAll, afterEach, beforeEach, jest, mock, spyOn, test, vi } from "bun:test";
const lines = [];
const told = async ask => {
  try {
    return String(await ask());
  } catch (error) {
    return "threw " + error.name;
  }
};
const look = async step => {
  let held;
  try {
    held = { serve: require("./kitchen.cjs").serve, kettle: require("./kettle.cjs") };
  } catch (error) {
    lines.push(step + " the load threw " + error.name);
    return;
  }
  lines.push(
    [
      step,
      await told(() => held.serve()),
      await told(() => held.kettle.boil()),
      await told(() => held.kettle.brand),
      await told(() => held.kettle.boil.mock?.calls.length ?? "-"),
      globalThis.boiled ?? 0,
    ].join(),
  );
};
test("first", async () => {
  jest.mock("./kettle.cjs");
  await look("1");
});
test("second", async () => {
  jest.mock("./kettle.cjs");
  await look("2");
});
afterAll(() => {
  console.log("SAID " + (lines.join(" . ") || "nothing"));
});

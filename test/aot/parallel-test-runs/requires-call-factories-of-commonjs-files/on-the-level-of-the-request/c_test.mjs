import { jest, mock, test, vi } from "bun:test";
vi.mock("./leaf.mjs", async () => {
  console.log("factory of leaf");
  await 0;
  return { leaf: "mock" };
});
mock.module("./fx.mjs", () => {
  console.log("factory of fx");
  return { rate: "mock" };
});
test("c", () => {
  mock.module("./cents.cjs", () => {
    console.log("factory of cents");
    return { cents: "mock" };
  });
  try {
    require("./sale.mjs");
  } catch (error) {
    console.log("c", error.name);
  }
});

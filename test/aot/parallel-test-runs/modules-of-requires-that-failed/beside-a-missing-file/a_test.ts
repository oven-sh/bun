import { test } from "bun:test";

test("a module whose graph fails is required", () => {
  try {
    console.log(require("./checkout").checkout());
  } catch (error: any) {
    console.log("a", error.message.split("'")[0]);
  }
});

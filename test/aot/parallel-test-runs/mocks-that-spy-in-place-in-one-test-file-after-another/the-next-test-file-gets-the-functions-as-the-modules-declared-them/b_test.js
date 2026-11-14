import { test, vi } from "bun:test";
import { Plain, config } from "./models.js";
test("the next file has what ./models.js declared", () => {
  console.log("SAID in the next file", new Plain().hello(), config.load());
  console.log(
    "SAID on ./models.js",
    vi.isMockFunction(config.load),
    vi.isMockFunction(Plain.prototype.hello),
    Plain.prototype.constructor === Plain,
  );
});

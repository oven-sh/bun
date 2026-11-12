import { test, vi } from "bun:test";
import * as barrel from "./barrel.js";
import { Plain, config } from "./models.js";
vi.mock("./barrel.js", { spy: true });
test("the mock spies on what ./barrel.js re-exports", () => {
  barrel.config.load.mockReturnValue("mocked by the first file");
  console.log("SAID in the first file", new barrel.Plain().hello(), barrel.config.load());
  console.log(
    "SAID on ./models.js",
    vi.isMockFunction(config.load),
    vi.isMockFunction(Plain.prototype.hello),
    Plain.prototype.constructor === barrel.Plain,
  );
});

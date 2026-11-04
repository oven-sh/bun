// The test file calls the helper through a folder whose index exports it again, twice over.
import { afterEach, mock, test } from "bun:test";
import * as Helpers from "./helpers/index.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("each", () => {
  Helpers.failing("logHalf", "half");
  console.log(read());
  Helpers.failing("logAdd", "add");
  console.log(read());
});

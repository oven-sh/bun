import { spyOn, test } from "bun:test";
import * as own from "./own-require.mjs";
import { read } from "./reader.mjs";
test("the spy answers", () => {
  const before = read();
  const spy = spyOn(own, "fetch_").mockImplementation((name) => "spied " + name);
  const during = read();
  spy.mockRestore();
  console.log(before, "|", during, "|", read());
});

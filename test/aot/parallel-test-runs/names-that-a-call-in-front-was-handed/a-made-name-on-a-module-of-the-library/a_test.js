// The names come from the module itself. Whoever imports one of them, by whatever form, sees the spy.
import { afterEach, mock, spyOn, test } from "bun:test";
import * as path from "node:path";
import { byDefault, byName, byRequire, byStar } from "./readers.js";

afterEach(() => mock.restore());
test("names that end in name", () => {
  for (const spy of Object.keys(path)
    .filter(name => name.endsWith("name"))
    .map(name => spyOn(path, name))) {
    spy.mockReturnValue("spied");
  }
  console.log(byName("/a/b.txt"), byDefault("/a/b.txt"), byStar("/a/b.txt"), byRequire("/a/b.txt"));
});
test("restored", () => console.log(byName("/a/b.txt"), byDefault("/a/b.txt"), byStar("/a/b.txt"), byRequire("/a/b.txt")));

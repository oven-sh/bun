// The object is the parameter of a callback over a list of namespaces, the names are its own keys. `other.js` is in no list: nothing of it is replaced.
import { afterEach, mock, spyOn, test } from "bun:test";
import * as path from "node:path";
import * as math from "./math.js";
import { base } from "./other.js";
import { read } from "./reader.js";

afterEach(() => mock.restore());
test("every function of both", () => {
  const spies = [math, path].flatMap(module =>
    Object.entries(module).flatMap(([name, member]) => (typeof member === "function" ? [spyOn(module, name)] : [])),
  );
  console.log(read(), base("/a/b.txt"));
  console.log(spies.filter(spy => spy.mock.calls.length > 0).length);
});
test("restored", () => console.log(read(), base("/a/b.txt")));

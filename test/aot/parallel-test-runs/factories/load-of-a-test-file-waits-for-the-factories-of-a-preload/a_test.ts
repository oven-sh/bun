// No import() is called. The runner asks the loader for the test file, whose statements lead to two modules that a preload has mocked: the load waits for each factory in turn.
import { test } from "bun:test";
import { name as one } from "./one";
import { name as two } from "./two";

console.log("the test file runs and sees", one, "and", two);

test("the names are the mocks'", () => {
  console.log(one, two);
});

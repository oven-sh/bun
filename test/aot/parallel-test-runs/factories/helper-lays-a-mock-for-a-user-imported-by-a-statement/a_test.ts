// The cases helper-* of test/aot/mock-rules: helper.ts mocks dep.ts in its body, and the test file imports user.ts, which imports dep.ts, by a statement behind it.
// The mock ends with the test file. The next test file that imports helper.ts sees the mock through user.ts again; one that does not import it sees the file.
import "./helper";
import { test } from "bun:test";
import { read } from "./user";

test("file 1", () => {
  console.log("file 1:", read());
});

// A call of import.meta.resolveSync() stores nothing on import.meta. So the build still follows the path below into the folder of this file,
// compiles the helper with the tests, and lets its spy through.
import { test } from "bun:test";
import { viaOwn } from "./target.mjs";
const own = import.meta.resolveSync("./a_test.mjs");
test("a helper named through import.meta.dir spies on a compiled file", async () => {
  const name = process.argv.length > 99 ? "other" : "helper";
  const helper = await import(import.meta.dir + "/rows/" + name + ".mjs");
  console.log("SEEN", helper.run(), viaOwn(), own.endsWith("a_test.mjs"));
});

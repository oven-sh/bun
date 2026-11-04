// `import * as all from "./barrel.js"`, and the object goes on to another file. A mock stands behind the star of the barrel: read off the import, off the object that was handed on, and by a pattern.
import { test, vi } from "bun:test";

test("the object of a barrel in front of a mock", async () => {
  vi.doMock("./lib.js", () => ({ fn: () => "mock fn", added: "mock added" }));
  const { readOffImport } = await import("./reader.js");
  const { readOffHandedOn, readByPattern, readByKey, readInLoop } = await import("./user.js");
  console.log("| off the import", readOffImport());
  console.log("| off what was handed on", readOffHandedOn());
  console.log("| by a pattern", readByPattern());
  console.log("| by a key", readByKey("fn"), readByKey("added"), readByKey("kept"));
  console.log("| in a loop", readInLoop());
});

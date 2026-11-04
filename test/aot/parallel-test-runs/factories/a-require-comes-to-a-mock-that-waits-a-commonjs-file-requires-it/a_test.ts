// The require() stands in a CommonJS file of the project.
import { test, vi } from "bun:test";

vi.doMock("./rate.cjs", async importOriginal => {
  console.log("factory begins");
  const original = await importOriginal();
  return { ...original, rate: 2 };
});

test("a file of the project requires it, then an import comes, then the file requires it again", async () => {
  const { read } = require("./reader.cjs");
  console.log("first", read());
  console.log("imported", (await import("./rate.cjs")).rate);
  console.log("behind the import", read());
});

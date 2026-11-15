import { vi } from "bun:test";

vi.doMock("./below.mjs", () => {
  console.log("the factory of the file below is called");
  return { depth: "of the preload" };
});

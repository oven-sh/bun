import { jest, test, vi } from "bun:test";
test("vi.importMock and jest.requireMock of a package", async () => {
  console.log("SAID", (await vi.importMock("made-up-pkg")).who, jest.requireMock("made-up-pkg").who, (await import("made-up-pkg")).who);
});

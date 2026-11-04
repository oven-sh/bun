import { test, vi } from "bun:test";

// Both readers are linked while the mock stands. One of them also holds a function of the mock in a variable of its own.
test("whoever was linked to a mock goes on reading it when it has ended", async () => {
  vi.doMock("./lib", () => ({ who: "mock", say: () => "mock says" }));
  const byName = await import("./by-name");
  const byNamespace = await import("./by-namespace");
  console.log("mocked:", byName.read(), byName.readHeld(), byNamespace.read());
  vi.doUnmock("./lib");
  console.log("ended:", byName.read(), byName.readHeld(), byNamespace.read());
  console.log("the module:", (await import("./lib")).who);
  console.log("behind a load of the module:", byName.read(), byName.readHeld(), byNamespace.read());
});

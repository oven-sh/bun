import { test, vi } from "bun:test";
import * as barrel from "./barrel";

const keys = (object: object) => Object.keys(object).sort().join("+");

// The factory takes the original, so the mock passes on the names of the original behind `export *`: what it adds stays behind.
test("a name that a mock adds beside the original is no key of a barrel", async () => {
  console.log("loaded:", keys(barrel), barrel.fn());
  await vi.doMock("./lib", async importOriginal => ({ ...((await importOriginal()) as object), fn: () => "mock fn", added: "mock added" }));
  const after = await import("./after");
  console.log("mocked:", keys(barrel), after.read());
});

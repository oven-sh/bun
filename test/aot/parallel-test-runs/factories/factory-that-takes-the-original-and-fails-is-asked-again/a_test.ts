// A factory that takes importOriginal throws at its first call. `bun test` loads the original first and lays such a mock over it, so the loader keeps no record with the error:
// the next load of the importer asks the factory again.
import { test, vi } from "bun:test";

let calls = 0;
vi.doMock("./mocked", importOriginal => {
  console.log("factory call", ++calls);
  if (calls === 1) throw new Error("the factory failed");
  return { v: "mock v" };
});
const said = (value: unknown) => (value instanceof Error ? value.message : value);

test("fails once", async () => {
  console.log("first:", said(await import("./names").then(it => it.seen(), error => error)));
  console.log("its importer again:", said(await import("./names").then(it => it.seen(), error => error)));
  console.log("the module:", said(await import("./mocked").then(it => it.v, error => error)));
  console.log("calls:", calls);
});

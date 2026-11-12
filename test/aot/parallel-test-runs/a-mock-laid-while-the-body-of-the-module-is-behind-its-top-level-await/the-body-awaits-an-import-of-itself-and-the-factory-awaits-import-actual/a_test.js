import { test, vi } from "bun:test";
// The body of slow.mjs awaits an import() of slow.mjs itself, which a closure of this file makes for it once the mock is laid.
test("the body waits for its own mock", async () => {
  let said = "not entered";
  let open;
  const gate = new Promise(done => {
    open = done;
  });
  const call = Promise.withResolvers();
  globalThis.warm = () => { call.resolve(); return gate.then(() => import("./slow.mjs")); };
  const first = import("./slow.mjs");
  first.catch(() => {});
  await call.promise;
  vi.doMock("./slow.mjs", async () => {
    said = "entered";
    await vi.importActual("./slow.mjs");
    said = "answered";
    return { late: "mocked" };
  });
  open();
  const own = await first;
  console.log("SAID first", own.late, "|", said);
  const again = await import("./slow.mjs");
  console.log("SAID again", String(again.late), "|", said);
}, 12000);

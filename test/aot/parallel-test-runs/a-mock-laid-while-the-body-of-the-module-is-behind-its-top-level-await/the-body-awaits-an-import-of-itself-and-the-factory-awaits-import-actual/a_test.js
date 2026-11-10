import { test, vi } from "bun:test";
const rest = time => new Promise(done => setTimeout(done, time));
const orHung = promise => Promise.race([promise, new Promise(done => setTimeout(done, 1500, "HUNG"))]);
// The body of slow.mjs awaits an import() of slow.mjs itself, which a closure of this file makes for it once the mock is laid.
test("the body waits for its own mock", async () => {
  let said = "not entered";
  let open;
  const gate = new Promise(done => {
    open = done;
  });
  globalThis.warm = () => gate.then(() => import("./slow.mjs"));
  const first = import("./slow.mjs");
  first.catch(() => {});
  await rest(300);
  vi.doMock("./slow.mjs", async () => {
    said = "entered";
    await vi.importActual("./slow.mjs");
    said = "answered";
    return { late: "mocked" };
  });
  open();
  const own = await orHung(first);
  console.log("SAID first", own === "HUNG" ? own : own.late, "|", said);
  const again = await orHung(import("./slow.mjs"));
  console.log("SAID again", again === "HUNG" ? again : String(again.late), "|", said);
}, 12000);

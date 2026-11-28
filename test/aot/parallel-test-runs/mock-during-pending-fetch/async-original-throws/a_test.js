import { test, vi } from "bun:test";
const describe = (promise, name) => promise.then(all => name + " " + Object.keys(all).join() + " " + String(all.early ?? all.seen), error => name + " threw " + error.name);
test("t", async () => {
  let calls = 0;
  const first = import("./module.mjs");
  vi.doMock("./module.mjs", async original => { calls++; return { ...(await original()), added: 1 }; });
  const second = import("./module.mjs");
  // Both are listened to before either is awaited. A rejection that nobody listens to fails the test, and the second call now and then rejects a turn before the first is heard.
  const [one, two] = [describe(first, "first"), describe(second, "second")];
  console.log("SAID", await one, "|", await two, "|", calls, globalThis.ran);
  console.log("SAID", await describe(import("./module.mjs"), "again"), calls, globalThis.ran);
}, 9000);

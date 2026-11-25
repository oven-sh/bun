const { test, vi, mock, jest } = require("bun:test");
const user = () => require("./user.cjs").read();
const load = async () => { const it = await import("./lib.cjs"); return it.word + " " + it.run; };
const say = (...all) => console.log("SAID", "a", globalThis.runs, ...all);
test("a", async () => {
  vi.doMock("./lib.cjs", async () => ({ ...(await vi.importActual("./lib.cjs")), word: "mock" }));
  say("beside", user());
  say("mocked", await load());
});

const { test, mock } = require("bun:test");
const call = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
test("t", async () => {
  const own = require("./own.cjs"), run = own.run;
  console.log("SAID before", run(5), own.run(3));
  await mock.module("./own.cjs", () => ({ run: () => "mocked" }));
  console.log("SAID mocked", call(() => require("./own.cjs").run(1)), call(() => run(4)));
});

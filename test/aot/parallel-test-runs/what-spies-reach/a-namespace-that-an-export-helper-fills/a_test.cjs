const { test, spyOn } = require("bun:test");
const own = require("./own.cjs"), whole = require("./whole.cjs");
const say = (...all) => console.log("SAID", ...all.map(f => { try { return String(f()); } catch (e) { return e.constructor.name; } }));
const spied = (f, then) => { let spy; try { spy = f(); } catch (e) { console.log("SAID no spy", e.constructor.name); } then(); if (spy) spy.mockRestore(); };
test("t", () => {
  const all = () => say(own.run, () => own.lib.add(1, 2), whole.run, () => whole.twice(3));
  all();
  spied(() => spyOn(own.lib, "add").mockReturnValue(9), all);
  spied(() => spyOn(own.lib, "count", "get").mockReturnValue(7), all);
  spied(() => spyOn(whole, "twice").mockReturnValue(8), all);
  all();
});

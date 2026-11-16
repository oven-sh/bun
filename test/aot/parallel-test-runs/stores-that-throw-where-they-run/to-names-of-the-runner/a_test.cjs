const say = (label, act) => { let seen = "no throw"; try { act(); } catch (e) { seen = e.name + ": " + e.message; } console.log(label, seen); };
function neverCalled() { describe = 1; }
function store(object) { with (object) { expect = "stored"; } return String(object.expect); }
function add(object) { with (object) { expect += "!"; } return String(object.expect); }
try { expect = "stored"; } catch (e) { console.log("at load", e.name); }
test("stores", () => {
  const log = [];
  say("=", () => { expect = (log.push("right"), 1); });
  say("++", () => { jest++; });
  say("+=", () => { jest += (log.push("added"), 1); });
  say("||=", () => { jest ||= (log.push("or"), 1); });
  say("&&=", () => { jest &&= (log.push("and"), 1); });
  say("[]", () => { [expect] = [1]; });
  say("{}", () => { ({ expect } = { expect: 1 }); });
  say("for of", () => { for (expect of [1]); });
  say("for in", () => { for (expect in { a: 1 }); });
  say("with", () => { console.log(store({ expect: 1 }), add({ expect: "a" })); });
  say("with nothing", () => { store({}); });
  console.log(log.join(), typeof expect, typeof jest, typeof describe, typeof neverCalled);
});

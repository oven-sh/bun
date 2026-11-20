import { expect, test } from "bun:test";
import first, { count, bump } from "./counter.js";
import * as ns from "./counter.js";
import { readFileSync } from "node:fs";
import { store } from "./helper.js";
const say = (label, act) => { let seen = "no throw"; try { act(); } catch (e) { seen = e.name + ": " + e.message; } console.log(label, seen); };
function neverCalled() { count = 100; }
try { count = 7; } catch (e) { console.log("at load", e.name); }
test("stores", () => {
  const log = [];
  const list = { [Symbol.iterator]() { return { next() { log.push("next"); return { done: false, value: 9 }; }, return() { log.push("return"); return {}; } }; } };
  say("=", () => { count = (log.push("right"), 5); });
  say("++", () => { count++; });
  say("+=", () => { count += (log.push("added"), 5); });
  say("||=", () => { count ||= (log.push("or"), 9); });
  say("&&=", () => { count &&= (log.push("and"), 9); });
  say("??=", () => { count ??= (log.push("nullish"), 9); });
  say("[]", () => { [count] = list; });
  say("{}", () => { ({ count } = { count: 9 }); });
  say("...", () => { ({ ...count } = { a: 1 }); });
  say("for of", () => { for (count of [1]); });
  say("for in", () => { for (count in { a: 1 }); });
  say("for of nothing", () => { for (count of []); });
  say("ns", () => { ns = 1; });
  say("default", () => { first = 1; });
  say("node", () => { readFileSync = 1; });
  say("runner", () => { expect = 1; });
  say("helper", store);
  console.log(log.join(), count, bump(), count, typeof ns, first, typeof readFileSync, typeof expect, typeof neverCalled);
});

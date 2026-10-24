// A store through a module namespace object inside a function that is called later, which throws a TypeError when it runs.
import * as ns from "./m.js";
const log = []; const note = (x) => (log.push(x), x);
const tell = (name, f) => { try { const r = f(); console.log(name + ": " + (typeof r === "function" ? "function" : String(r))); } catch (e) { console.log(name + ": threw " + e.name); } };
function poke(V) { ns.k = V; }
tell("first", () => ns.inside());
for (const V of [7, 1.5, "text", { a: 9 }, () => "second", null, undefined]) {
  log.length = 0;
  tell("the store", () => { poke(note(V)); });
  tell("evaluated", () => log.map((x) => typeof x === "function" ? "function" : typeof x === "object" && x ? "object" : String(x)).join());
  tell("outside", () => typeof ns.k);
  tell("inside", () => ns.inside());
  tell("hot", () => ns.hot());
}

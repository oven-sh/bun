// An imported `const` arrow function is assigned to with `+=`, which throws a TypeError when it runs.
import * as star from "./m.js";
const ns = star;
const log = []; const note = (x) => (log.push(x), x);
const tell = (name, f) => { try { const r = f(); console.log(name + ": " + (typeof r === "function" ? "function" : String(r))); } catch (e) { console.log(name + ": threw " + e.name); } };
tell("first", () => ns.inside());
for (const V of [7, 1.5, "text", { a: 9 }, () => "second", null, undefined]) {
  log.length = 0;
  tell("the store", () => { ns.k += note(V); });
  tell("evaluated", () => log.map((x) => typeof x === "function" ? "function" : typeof x === "object" && x ? "object" : String(x)).join());
  tell("outside", () => typeof ns.k);
  tell("inside", () => ns.inside());
  tell("hot", () => ns.hot());
}

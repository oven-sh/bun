import { report } from "./report.mjs";
import { a, f, hoisted, laterLet, n, o, s, useAll } from "./second.mjs";

function outcome(run) {
  try {
    const value = run();
    return typeof value === "number" ? String(value) : (JSON.stringify(value) ?? "undefined");
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
export function uses(when) {
  report.push(when + " n + 1 -> " + outcome(() => n + 1));
  report.push(when + " n | 0 -> " + outcome(() => n | 0));
  report.push(when + " a.push(1) -> " + outcome(() => (a.push(1), a.length)));
  report.push(when + " s.charCodeAt(0) -> " + outcome(() => s.charCodeAt(0)));
  report.push(when + " f(1) -> " + outcome(() => f(1)));
  report.push(when + " o.x + o.y -> " + outcome(() => o.x + o.y));
  report.push(when + " hoisted(1) -> " + outcome(() => hoisted(1)));
  report.push(when + " laterLet + 1 -> " + outcome(() => laterLet + 1));
}
uses("after the other module ran,");
useAll("called from the first module,");
for (let i = 0; i < 1000; i++) n + 1;

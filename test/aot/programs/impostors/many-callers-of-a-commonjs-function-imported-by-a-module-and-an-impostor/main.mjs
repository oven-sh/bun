import tools, { sum, double, span, whoCalls } from "./tools.cjs";
import * as namespace from "./tools.cjs";
import user from "./user.cjs";
import { notLists, notNumbers, notPoints } from "./values.mjs";

function attempt(label, run) {
  let line;
  try {
    const value = run();
    line = typeof value === "string" ? JSON.stringify(value) : typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : String(value);
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line);
}

function honest(round) {
  console.log(round, "imported:", sum([1, 2, 3]), sum([]), sum(new Array(4, 5)), double(2), double(0.5), double(-1), span({ x: 3, y: 1 }), span({ x: 9, y: 4 }));
  console.log(round, "through the default:", tools.sum([1, 2]), tools.double(3), tools.span({ x: 2, y: 1 }));
  user.honest(round);
}

honest("before");
console.log("one function under every name:", tools.sum === sum, namespace.sum === sum, namespace.default === tools);
attempt("this of an imported name", () => whoCalls());
attempt("this through the default", () => tools.whoCalls());
attempt("this through the namespace", () => typeof namespace.whoCalls());
for (const [name, make] of notLists) {
  attempt("sum, imported by name, of " + name, () => sum(make()));
  attempt("sum, called by the other CommonJS module, of " + name, () => user.withValue("sum", make()));
}
for (const [name, make] of notNumbers) {
  attempt("double, through the default export, of " + name, () => tools.double(make()));
  attempt("double, through the namespace by a computed name, of " + name, () => namespace[["dou", "ble"].join("")](make()));
}
for (const [name, make] of notPoints) {
  attempt("span, through a copy of the namespace, of " + name, () => ({ ...namespace }).span(make()));
  attempt("span, called by the other CommonJS module, of " + name, () => user.withValue("span", make()));
}
const original = tools.double;
tools.double = text => "replaced " + text;
attempt("after the exports object was changed, through the default", () => tools.double(2));
user.honest("while double is replaced");
tools.double = original;
honest("after");

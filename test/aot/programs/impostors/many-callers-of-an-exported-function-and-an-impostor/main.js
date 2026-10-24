import * as tools from "./tools.js";
import { step, replaceStep, Counter } from "./tools.js";
import { honest } from "./honest.js";
import { attempt } from "./report.js";
import { notNumbers, notPoints, notTexts } from "./values.js";
import { sumImpostors } from "./impostor.js";
import { yell, everything } from "./again.js";

honest("before");
sumImpostors();

const memberName = ["dou", "ble"].join("");
for (const [name, make] of notNumbers) attempt("double, a member of the namespace read by a computed name, of " + name, () => tools[memberName](make()));

const loaded = await import("./" + ["to", "ols"].join("") + ".js");
console.log("the module loaded by a computed name is the same:", loaded.default === tools.default, loaded.sum === tools.sum);
for (const [name, make] of notPoints) attempt("span, the default export of a module loaded by a computed name, of " + name, () => loaded.default(make()));

for (const [name, make] of notTexts) attempt("shout, exported again under another name, of " + name, () => yell(make()));
for (const [name, make] of notNumbers) attempt("low, through a namespace exported again, of " + name, () => everything.low(make()));

for (const [name, make] of notNumbers) attempt("step of " + name, () => step(make()));
replaceStep(text => text.length);
attempt("step after it was replaced, of a string", () => step("four"));
attempt("step after it was replaced, of a number", () => step(4));
replaceStep("not a function");
attempt("step after a string replaced it", () => step(4));
replaceStep(n => n + 1);

for (const [name, make] of notNumbers) {
  attempt("a counter that starts at " + name, () => new Counter(make()).add(1));
  attempt("a counter that adds " + name, () => new Counter(1).add(make()));
}
honest("after");

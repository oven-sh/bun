// One `await import(name)` whose name comes out of a Set that closures fill at run time from a written table of built-in modules.
// The build knows what the name may be, so the load finds those modules and nothing else: no file of the program is handed out by it,
// and the passes over the whole program go on editing.
// STATISTIC: PromoteEnvironmentsToVariablesChanges >= 1
// STATISTIC: RemoveUnreadExportsChanges >= 1
// STATISTIC: DeferDefinitionsChanges >= 1
// STATISTIC: EnvironmentsPromotedToVariables >= 1
// STATISTIC: UnreadVariableStoresRemoved >= 1
// STATISTIC: ClosuresDeferredInVariables >= 1
// STATISTIC: ImageFunctionsAndJumpsInTheirPlace <= 4389
// STATISTIC: FlowEdgesLogged <= 300000
import { createRequire } from "node:module";
import { name as pluginName } from "./app/plugin.ts";
import { add, makeCounter, pattern, Shape } from "./app/shapes.ts";
import { install } from "./wires.ts";

const isOn = false;
const off = isOn ? require("./app/off.ts") : null;

function outer() {
  let held = 3;
  const inner = () => held * 2;
  return inner() + held;
}

const counter = makeCounter(4);
counter.next();
console.log(counter.next(), new Shape(3).area(), add(2), add(3), pattern.test("aab"), outer(), off === null);
// A load by a path that the build does not follow stands beside it, and finds its file.
const plugin = await import(process.env.PLUGIN ?? import.meta.dir + "/app/plugin.ts");
console.log(plugin.name === pluginName);
const calls = await install(createRequire(import.meta.url));
console.log(calls.length);
console.log(calls.join("\n"));

// @runtime node, bun
import * as vm from "node:vm";
import { bench, run } from "../runner.mjs";

const context = {
  animal: "cat",
  count: 2,
};

const script = new vm.Script("animal = 'hey'");

vm.createContext(context);

bench("new vm.Script(source)", () => {
  new vm.Script("animal = 'hey'");
});

bench("new vm.Script(source, { filename })", () => {
  new vm.Script("animal = 'hey'", { filename: "hey.js" });
});

let alternate = 0;
bench("new vm.Script(source, { filename }), two filenames in turn", () => {
  new vm.Script("animal = 'hey'", { filename: alternate++ & 1 ? "hey.js" : "hi.js" });
});

let distinct = 0;
bench("new vm.Script(source), a new source each call", () => {
  new vm.Script("count = " + distinct++);
});

bench("vm.Script.runInContext", () => {
  script.runInContext(context);
});

bench("vm.Script.runInContext, options object", () => {
  script.runInContext(context, { displayErrors: true });
});

bench("vm.Script.runInThisContext", () => {
  script.runInThisContext(context);
});

bench("vm.Script.runInNewContext", () => {
  script.runInNewContext(context);
});

bench("vm.runInContext", () => {
  vm.runInContext("animal = 'hey'", context);
});

bench("vm.runInNewContext", () => {
  vm.runInNewContext("animal = 'hey'", context);
});

bench("vm.runInThisContext", () => {
  vm.runInThisContext("animal = 'hey'", context);
});

bench("vm.createContext", () => {
  vm.createContext({ yo: 1 });
});

await run();

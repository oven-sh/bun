// @runtime node, bun
import * as vm from "node:vm";
import { bench, run } from "./runner.mjs";

const context = {
  animal: "cat",
  count: 2,
};

const script = new vm.Script("animal = 'hey'");

vm.createContext(context);

bench("vm.Script.runInContext", () => {
  script.runInContext(context);
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

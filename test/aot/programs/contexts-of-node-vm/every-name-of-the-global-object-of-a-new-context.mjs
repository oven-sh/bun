// Every own name of the global object of a context of node:vm, with the own names of its value and of its prototype.
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
const context = vm.createContext({});
await show("names", () => vm.runInContext("Object.getOwnPropertyNames(globalThis).sort().join()", context));
await show("each", () => vm.runInContext(`Object.getOwnPropertyNames(globalThis).sort().map(name => {
  try {
    const value = globalThis[name];
    const own = value !== null && (typeof value === "object" || typeof value === "function") ? Object.getOwnPropertyNames(value).sort().map(key => { try { return key + ":" + typeof value[key]; } catch (error) { return key + ":threw " + error.name; } }).join(" ") : String(value);
    const proto = typeof value === "function" && value.prototype ? Object.getOwnPropertyNames(value.prototype).sort().map(key => { try { return key + ":" + typeof Object.getOwnPropertyDescriptor(value.prototype, key).value; } catch (error) { return key + ":threw " + error.name; } }).join(" ") : "";
    return name + " " + typeof value + " | " + own + " | " + proto;
  } catch (error) {
    return name + " threw " + error.name;
  }
}).join("\\n")`, context).split("\n"));

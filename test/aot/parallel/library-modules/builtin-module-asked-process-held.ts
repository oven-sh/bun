// A built in module is asked of process held in a constant.
type Hooks = { AsyncLocalStorage?: unknown };
type Held = { process?: { getBuiltinModule?: (specifier: string) => Hooks } };

function ask(label: string, probe: () => unknown) {
  try {
    console.log(label, typeof probe());
  } catch (error) {
    console.log(label, (error as Error).name);
  }
}

const heldProcess = process;
const heldGlobal = globalThis;
const retypedGlobal = globalThis as unknown as Held;

ask("process", () => process.getBuiltinModule("node:async_hooks").AsyncLocalStorage);
ask("a constant that holds process", () => heldProcess.getBuiltinModule("node:dgram").createSocket);
ask("a constant that holds the global object", () => heldGlobal.process.getBuiltinModule("node:readline").createInterface);
ask("the global object under another type", () => retypedGlobal.process?.getBuiltinModule?.("node:diagnostics_channel"));

let found: unknown;
for (const probe of [() => retypedGlobal.process?.getBuiltinModule?.("node:vm")]) {
  try {
    found = probe();
  } catch {}
  if (found) break;
}
console.log("one of a list of probes", typeof found);

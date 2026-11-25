// Direct calls pass the module's first mutable i32 global in a register. Everything else sees it in the instance: JavaScript, calls through imports and tables, other instances, and what runs after a fault.
// STATISTIC: WasmOptimizedCopies = 18
// STATISTIC: WasmDirectEntries = 18
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
let hook = (n: number): number => n;
const instantiate = () => new WebAssembly.Instance(module, { env: { hook: (n: number) => hook(n) } }).exports as any;
const e = instantiate();
const second = instantiate();

function outcomeOf(run: () => unknown): string {
  try {
    return "returned " + run();
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message.replace(/ \(evaluating .*/, "");
  }
}
const say = (name: string, run: () => unknown) => console.log(name, outcomeOf(run), "global", e.get(), second.get());

for (let round = 0; round < 3; round++) {
  say("push", () => e.push(16));
  say("pop", () => e.pop(8));
  say("leaf", () => e.leaf(1000));
  say("passesOn", () => e.passesOn(12));
  say("frame", () => e.frame(50));
  say("writes", () => e.writes(21));
  say("deep", () => e.deep(300));
  say("everyKind", () => e.everyKind(9));

  hook = n => n * 2;
  say("throughImport, plain", () => e.throughImport(5));
  hook = n => e.push(n) + e.frame(3);
  say("throughImport, pushes", () => e.throughImport(6));
  hook = n => (n ? e.throughImport(n - 1) + e.unbalanced(1) : e.get());
  say("throughImport, nested", () => e.throughImport(4));
  hook = n => second.push(n) + second.get();
  say("throughImport, another instance", () => e.throughImport(7));
  hook = () => {
    e.push(100);
    throw new Error("thrown by the hook");
  };
  say("throughImport, throws", () => e.throughImport(8));

  hook = n => e.unbalanced(n) - 1;
  for (let index = 0; index < 8; index++) say("throughTable " + index, () => e.throughTable(index, 40));
  e.table.set(6, second.push);
  e.table.set(7, second.throughImport);
  say("throughTable, another instance", () => e.throughTable(6, 24));
  say("throughTable, another instance and back", () => e.throughTable(7, 24));
  e.table.set(6, null);

  say("faults inside", () => e.faults(16));
  say("faults", () => e.faults(65536));
  say("callsFaults", () => e.callsFaults(65536));
  say("after the faults", () => e.frame(2));
  e.set(60000 + round);
  say("set", () => e.passesOn(3));
}

// A channel enters and leaves a store that has getStore() and enterWith(), and no withScope().
import { channel } from "node:diagnostics_channel";

let value: unknown = "outer";
const entered = channel("entered");
entered.bindStore({ getStore: () => value, enterWith: (next: unknown) => (value = next) } as any);
console.log(
  entered.runStores("inner", () => value),
  value,
);

import vm from "node:vm";
import * as later from "./later.mjs";

for (const sandbox of [later, new Proxy(later, {})]) {
  const contextGlobal = vm.runInContext("this", vm.createContext(sandbox));
  console.log(Bun.inspect(contextGlobal, { compact: true }));
  console.log(Bun.inspect(contextGlobal, { sorted: true, compact: true }));
}

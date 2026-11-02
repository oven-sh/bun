// A function that a module exports and nothing is stored over is read by name through the namespace object, at a site with many receivers, again and again: the third read is answered by the caches. numbers.ts fills the memory of the module variables, so that a read from a wrong place there finds something.
// Flags: --aot-validate --aot-only-passes=AnalyzeFlow
import { bump, total } from "./numbers.ts";
import { ran } from "./plugin.ts";
interface Startable { method(): void; [name: string]: unknown }
let literals = 0;
const receivers: Startable[] = [
  { k0: 0, method() { literals += 0; } },
  { k1: 1, method() { literals += 1; } },
  { k2: 2, method() { literals += 2; } },
  { k3: 3, method() { literals += 3; } },
  { k4: 4, method() { literals += 4; } },
  { k5: 5, method() { literals += 5; } },
  { k6: 6, method() { literals += 6; } },
  { k7: 7, method() { literals += 7; } },
  { k8: 8, method() { literals += 8; } },
  { k9: 9, method() { literals += 9; } },
  { k10: 10, method() { literals += 10; } },
  { k11: 11, method() { literals += 11; } },
  { k12: 12, method() { literals += 12; } },
  { k13: 13, method() { literals += 13; } },
  { k14: 14, method() { literals += 14; } },
  { k15: 15, method() { literals += 15; } },
  { k16: 16, method() { literals += 16; } },
  { k17: 17, method() { literals += 17; } },
  { k18: 18, method() { literals += 18; } },
  { k19: 19, method() { literals += 19; } },
  { k20: 20, method() { literals += 20; } },
  { k21: 21, method() { literals += 21; } },
  { k22: 22, method() { literals += 22; } },
  { k23: 23, method() { literals += 23; } },
];
receivers.push(require("./plugin.ts") as Startable);
function start(typed: Startable): void { typed.method(); }
bump();
for (let round = 0; round < 6; round++) for (const receiver of receivers) start(receiver);
bump();
console.log(ran(), literals, Math.round(total()));

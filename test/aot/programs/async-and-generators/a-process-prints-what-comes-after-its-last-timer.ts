// A process stays alive while a timer or an immediate is pending, and prints what comes after it, also when the thread was busy past every deadline.
import { setImmediate as immediate, setTimeout as timeout } from "node:timers/promises";

function stayBusy(milliseconds: number) {
  for (const began = performance.now(); performance.now() - began < milliseconds; );
}

const waits: Record<string, () => Promise<unknown>> = {
  "Bun.sleep": () => Bun.sleep(1),
  "setTimeout": () => new Promise(resolve => setTimeout(resolve, 1)),
  "setImmediate": () => new Promise(resolve => setImmediate(resolve)),
  "setTimeout of node:timers/promises": () => timeout(1),
  "setImmediate of node:timers/promises": () => immediate(),
};

async function waitThreeTimes(name: string, wait: () => Promise<unknown>) {
  for (let turn = 1; turn <= 3; turn++) {
    await wait();
    stayBusy(3);
  }
  console.log(`${name}: waited three times`);
}

let chain = Promise.resolve();
for (const [name, wait] of Object.entries(waits)) chain = chain.then(() => waitThreeTimes(name, wait));
chain.then(() => console.log("the last line"));
process.on("exit", code => console.log(`exit ${code}`));
stayBusy(20);

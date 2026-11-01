// The classes live in a module that two entry points import. Each Worker changes the methods in its own way and the main thread in a third; nobody sees the change of another. main.ts is the program; this file is what each Worker runs.
import { parentPort, workerData } from "node:worker_threads";
import { Double, make, Meter, total } from "./meters";

const meters = make();
const seen = [total(meters)];
if (workerData === 1) {
  Meter.prototype.read = function () {
    return this.base + 100;
  };
}
if (workerData === 2) Reflect.deleteProperty(Double.prototype, "read");
if (workerData === 3) meters[2].read = () => 300;
seen.push(total(meters), total(make()));
parentPort?.postMessage(seen);

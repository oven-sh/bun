// Several threads use the same Sets of constant strings; each changes its own and none sees another's change. start.ts is the program; this file is what each Worker runs.
import { parentPort, workerData } from "node:worker_threads";
import { change, describe } from "./names";

const before = describe("worker " + workerData + " before");
change(workerData);
parentPort!.postMessage([before, describe("worker " + workerData + " after")]);

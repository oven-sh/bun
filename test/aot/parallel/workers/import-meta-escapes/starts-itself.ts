import { parentPort, Worker, workerData } from "node:worker_threads";
export const keys = Object.keys(import.meta).length;
export const start = () => new Worker(new URL(import.meta.url), { workerData: "itself" });
if (workerData === "itself") parentPort!.postMessage("itself");

import { parentPort } from "node:worker_threads";
const doubled = [1, 2, 3].map(x => x * 2);
parentPort?.postMessage([doubled, doubled.length, Array.isArray(doubled)]);

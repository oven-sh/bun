import { Worker } from "node:worker_threads";
export const make = url => new Worker(url);

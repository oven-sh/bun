// A program that imports node:worker_threads reads the members of `process` that the host computes once as any other program does: out of the word that the first read has filled.
// Until 11-03 the library's own overrides for workers, under names out of a list, counted as a write to every member of `process`: each of these reads went by name.
// COUNT: operation:operationAOTFillBuiltinValue >= 3
import { isMainThread } from "node:worker_threads";
let sum = 0;
for (let i = 0; i < 1000; i++) sum += process.pid > 0 && process.argv0.length > 0 && process.execPath.length > 0 && process.version.length > 0 ? 1 : 0;
globalThis.said = [isMainThread, sum].join();

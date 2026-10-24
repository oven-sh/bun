// A validation fails on the main thread, then for the first time in a Worker, then on the main thread again: every thread gets the same kind of error. The build lists start.ts first, so the main thread runs that and starts this file as a Worker.
import { JSON } from "bun";
import { parentPort } from "node:worker_threads";
function messageOf(text: string): string {
  try {
    return JSON.stringify(JSON.parse<{ n: number }>(text));
  } catch (error: any) {
    return error.message;
  }
}
parentPort!.postMessage("worker: " + messageOf('{"n":true}') + ", " + messageOf('{"n":[]}'));

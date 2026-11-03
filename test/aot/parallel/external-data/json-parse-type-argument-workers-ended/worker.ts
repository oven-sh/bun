// Workers are ended from outside in the middle of `JSON.parse(text) as T` and JSON.stringify of large texts, forty times at other moments; the main thread goes on parsing. main.ts is the program; this file is what each Worker runs.
import { parentPort } from "node:worker_threads";
import { rows, work } from "./work";

const text = rows(60000);
parentPort!.postMessage("ready");
for (;;) work(text);

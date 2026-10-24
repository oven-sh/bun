// Two entry points share modules. The build lists start.ts first, so that is what the main thread runs: it imports a few modules statically, reaches others only through types and import(), and starts this file as a Worker, which imports all of them.
import { area, name as nameOfSecond } from "./second";
import { lines, log, name as nameOfFirst } from "./first";
import { total } from "./third";
import { describe } from "./shapes";
import { parentPort } from "node:worker_threads";

const required: { fourth: number } = require("./fourth.cjs");
log("worker", nameOfFirst, nameOfSecond, total(3), area({ kind: "circle", radius: 1 }).toFixed(2), describe({ kind: "square", side: 3 }), required.fourth);
parentPort!.postMessage(lines);

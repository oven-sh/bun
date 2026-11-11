import { EventEmitter } from "node:events";
import data from "./data.json";
import low from "./low.cjs";
export class Bus extends EventEmitter {}
export const get = () => data.n + low.n;

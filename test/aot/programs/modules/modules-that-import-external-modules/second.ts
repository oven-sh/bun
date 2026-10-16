import { log } from "./log.ts";
import { first } from "./first.ts";
import { EventEmitter } from "node:events";
import { extname } from "node:path";
const emitter = new EventEmitter();
let heard = "";
emitter.on("word", (word: string) => { heard += word; });
emitter.emit("word", "heard");
log("second is evaluated: " + heard + " " + extname("x.ts") + " " + first());
export function second(): string { return heard + extname("y.js"); }

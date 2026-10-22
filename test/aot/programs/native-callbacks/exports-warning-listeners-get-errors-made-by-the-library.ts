// The host's calls of library functions: process.emitWarning builds an Error of its own, or passes on the one it was given, and a tick later the "warning" listener gets it; a warning about too many listeners brings the program's emitter back.
import { EventEmitter } from "node:events";

class Notice extends Error {
  level = 3;
}

let total = 0;
const names: string[] = [];

function onWarning(notice: Notice): void {
  total += typeof notice.level === "number" ? notice.level : 100;
  names.push(notice.name + ":" + (notice as any).code);
  const emitter = (notice as any).emitter;
  if (emitter) emitter.emit("crowded", "text");
}

function onCrowded(value: number): void {
  total += typeof value === "number" ? 10000 : 1000000;
}

onWarning(new Notice("own"));
onCrowded(1);
process.removeAllListeners("warning");
process.on("warning", onWarning as (warning: Error) => void);
process.emitWarning("text", "CustomName", "CODE1");
process.emitWarning("plain");
process.emitWarning(new Notice("object"));
process.emitWarning("detailed", { type: "T", code: "C", detail: "D" });
const crowded = new EventEmitter().setMaxListeners(1);
crowded.on("crowded", onCrowded).on("crowded", () => {});
setTimeout(() => console.log(total, names.join()), 10);

// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import { Readable } from "node:stream";
const stream = new Readable();
console.log(
  stream.listeners("constructor").length,
  stream.rawListeners("valueOf").length,
  stream.listenerCount("toString"),
  stream.emit("hasOwnProperty"),
);
stream.on("constructor", () => console.log("heard"));
console.log(stream.listeners("constructor").length, stream.emit("constructor"));

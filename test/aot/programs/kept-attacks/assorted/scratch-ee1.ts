// Assorted, one probe of many. It prints what plain Bun prints.
import { EventEmitter } from "node:events";
function listener(value: number): void {
  console.log("got", value);
}
new EventEmitter().on("e", listener).emit("e", 1);

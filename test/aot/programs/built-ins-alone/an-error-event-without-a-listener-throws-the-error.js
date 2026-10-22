import { EventEmitter } from "node:events";
try {
  new EventEmitter().emit("error", new RangeError("out of range"));
} catch (error) {
  console.log(error instanceof RangeError, error.message.length);
}

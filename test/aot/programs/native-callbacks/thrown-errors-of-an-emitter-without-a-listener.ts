// Thrown values: emit("error", x) without a listener throws x itself where it is an Error and wraps anything else in an error of the library, with the value under `context`; with a listener, the listener gets x as it is.
import { EventEmitter } from "node:events";

class Failure extends Error {
  code = 7;
}

let total = 0;

function weigh(failure: Failure): number {
  if (typeof failure !== "object" || failure === null) return 1000000;
  return typeof failure.code === "number" ? failure.code : failure.code === "ERR_UNHANDLED_ERROR" ? 100 + (typeof (failure as any).context === "number" ? 10 : 0) : 10000;
}

const values: unknown[] = [new Failure("own"), 5, "text", null, { plain: true }, new TypeError("native kind")];
const silent = new EventEmitter();
for (const value of values) {
  try {
    silent.emit("error", value);
  } catch (error) {
    total += weigh(error as Failure);
  }
}
const heard = new EventEmitter();
heard.on("error", (failure: Failure) => void (total += weigh(failure) * 100000000));
heard.emit("error", new Failure("own"));
heard.emit("error", 5);
console.log(total);

// Exports of start-up modules and methods found through instances: an emitter that captures rejections calls its Symbol.for("nodejs.rejection") method with whatever an async listener rejected with.
import { EventEmitter } from "node:events";

class Failure extends Error {
  code = 7;
}

let total = 0;

class Bus extends EventEmitter {
  constructor() {
    super({ captureRejections: true });
  }
  [Symbol.for("nodejs.rejection")](error: Failure, event: string, first: number): void {
    total += error instanceof Failure ? error.code : typeof error === "string" ? 100 : error === undefined ? 1000 : 10000;
    total += typeof event === "string" ? 100000 : typeof event === "symbol" ? 1000000 : 0;
    total += typeof first === "number" ? first : typeof first === "string" ? 10000000 : 0;
  }
}

const bus = new Bus();
(bus as any)[Symbol.for("nodejs.rejection")](new Failure("mine"), "own", 1);
const name = Symbol("event");
bus.on("text", async () => { throw "text"; });
bus.on("nothing", async () => { throw undefined; });
bus.on(name, async () => { throw new Failure("late"); });
bus.emit("text", 2);
bus.emit("nothing", "two");
bus.emit(name);
setTimeout(() => console.log(total), 10);

// node:worker_threads: start() and removeAllListeners() leave a port receiving, so the message that comes next finds no listener and is gone. Nothing starts parentPort: what the parent posts waits for the first 'message' listener of the worker, unless the worker left the port receiving.
import {
  MessageChannel,
  Worker,
  isMainThread,
  parentPort,
  receiveMessageOnPort,
  workerData,
} from "node:worker_threads";

const listener = () => {};
const before = {
  "nothing": () => {},
  "start()": port => port.start(),
  "on() and off()": port => port.on("message", listener).off("message", listener),
  "on() and removeAllListeners('message')": port => port.on("message", listener).removeAllListeners("message"),
  "on() and removeAllListeners()": port => port.on("message", listener).removeAllListeners(),
  "on(), removeAllListeners(), on() and off()": port =>
    port.on("message", listener).removeAllListeners().on("message", listener).off("message", listener),
  "a 'close' listener and removeAllListeners()": port => port.on("close", listener).removeAllListeners(),
};

if (isMainThread) {
  for (const [name, prepare] of Object.entries(before)) {
    const { port1, port2 } = new MessageChannel();
    prepare(port2);
    port1.postMessage("unread");
    for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve));
    console.log(`a port after ${name}:`, receiveMessageOnPort(port2) ? "kept" : "gone");
    port1.close();
    port2.close();
  }

  // The worker says "started" once its entry point has run. Then the parent posts "late", and by the second port it lets the worker add its listener.
  for (const name of Object.keys(before)) {
    const gate = new MessageChannel();
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { name, gate: gate.port2 },
      transferList: [gate.port2],
    });
    const replies = [];
    worker.postMessage("early");
    worker.on("message", message => {
      if (message === "started") {
        worker.postMessage("late");
        gate.port1.postMessage("go");
      } else if (message === "listening") worker.postMessage("last");
      else replies.push(message);
    });
    const exitCode = await new Promise(resolve => worker.once("exit", resolve));
    gate.port1.close();
    console.log(`parentPort after ${name}:`, replies.join(", "), "| exit code", exitCode);
  }
} else {
  before[workerData.name](parentPort);
  workerData.gate.once("message", () => {
    parentPort.on("message", message => {
      parentPort.postMessage("got " + message);
      if (message === "last") process.exit(0);
    });
    parentPort.postMessage("listening");
  });
  setImmediate(() => parentPort.postMessage("started"));
}

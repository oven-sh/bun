// every prototype method hot enough for DFG and FTL: the compile reports give bytecode size and machine code size
const EventEmitter = require("node:events");
const e = new EventEmitter();
const c = new EventEmitter({ captureRejections: true });
const f = a => a;
const g = a => a;
e.on("keep", g);
c.on("x", f);
for (let i = 0; i < 300000; i++) {
  e.on("x", f);
  e.emit("x", 1);
  e.prependListener("x", g);
  e.listenerCount("x");
  e.listeners("x");
  e.rawListeners("x");
  e.eventNames();
  e.getMaxListeners();
  e.setMaxListeners(10);
  e.removeListener("x", g);
  e.off("x", f);
  e.once("y", f);
  e.emit("y", 1);
  e.prependOnceListener("y", f);
  e.emit("y", 1);
  c.emit("x", 1);
  if ((i & 1023) === 0) { e.on("z", f); e.removeAllListeners("z"); }
}

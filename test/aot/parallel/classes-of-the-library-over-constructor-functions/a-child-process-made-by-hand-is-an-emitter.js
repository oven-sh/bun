const { ChildProcess } = require("node:child_process");
const { EventEmitter } = require("node:events");
const child = new ChildProcess();
console.log(child instanceof EventEmitter, Object.getPrototypeOf(ChildProcess) === EventEmitter, Object.keys(child).join());
child.on("told", value => console.log(value, child.listenerCount("told")));
child.emit("told", 1);

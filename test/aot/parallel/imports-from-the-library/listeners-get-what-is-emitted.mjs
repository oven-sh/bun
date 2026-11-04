import { EventEmitter, once, on } from "node:events";
const bus = new EventEmitter();
let sum = 0;
function listener(a, b, c) { sum += a + (b | 0) + (c | 0) + arguments.length; }
bus.on("n", listener).prependListener("n", a => { sum += a * 100; }).once("n", () => { sum += 100000; });
for (let i = 0; i < 50; i++) bus.emit("n", i, 1, 2);
bus.off("n", listener);
bus.emit("n", 1);
console.log(sum, bus.listenerCount("n"), bus.eventNames().join());
const waited = once(bus, "later");
bus.emit("later", "value", 2);
console.log((await waited).join());

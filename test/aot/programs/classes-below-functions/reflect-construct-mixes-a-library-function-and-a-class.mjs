// new.target and the function that is constructed come from different sides.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
class Bus extends EventEmitter { constructor() { super(); this.bus = true; } hello() { return "bus"; } }
class Other { constructor() { this.other = true; } hello() { return "other"; } }
function show(o) { return Object.keys(o).join() + " " + (typeof o.hello === "function" ? o.hello() : "-") + " " + (o instanceof EventEmitter) + " " + (o instanceof Bus) + " " + (o instanceof Other); }
console.log(show(Reflect.construct(EventEmitter, [], Bus)));
console.log(show(Reflect.construct(EventEmitter, [], Other)));
console.log(show(Reflect.construct(Bus, [], Other)));
console.log(show(Reflect.construct(Bus, [], EventEmitter)));
console.log(show(Reflect.construct(Other, [], Bus)));
console.log(show(Reflect.construct(Readable, [{ read() {} }], Bus)));
const mixed = Reflect.construct(EventEmitter, [], Other);
try { mixed.on("x", () => {}); } catch (error) { console.log(error.constructor.name); }
const asBus = Reflect.construct(EventEmitter, [], Bus);
asBus.on("x", function () { console.log("heard", this.bus, this.hello()); });
asBus.emit("x");
function NoPrototype() {}
NoPrototype.prototype = 5;
console.log(Object.getPrototypeOf(Reflect.construct(EventEmitter, [], NoPrototype)) === Object.prototype);

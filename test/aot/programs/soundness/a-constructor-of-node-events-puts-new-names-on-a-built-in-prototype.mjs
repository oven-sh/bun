// The constructor of node:events stores its fields into Set.prototype, which the program holds as a value that the compiler cannot follow.
import { EventEmitter } from "node:events";
const hide = value => new CustomEvent("x", { detail: value }).detail;
console.log("before:", typeof new Set()._events, typeof new Set()._eventsCount);
EventEmitter.call(Object.getPrototypeOf(hide(new Set())));
console.log("after:", typeof new Set()._events, typeof new Set()._eventsCount, new Set()._eventsCount + 1);

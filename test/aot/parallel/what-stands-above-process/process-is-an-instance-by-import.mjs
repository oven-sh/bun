// `process` is an instance of the EventEmitter of node:events.
import { EventEmitter } from "node:events";
import theProcess from "node:process";
console.log(theProcess === process, theProcess instanceof EventEmitter, process instanceof EventEmitter);

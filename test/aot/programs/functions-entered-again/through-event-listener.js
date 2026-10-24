// One statement of the module enters a function, which is entered again by another way (event listener): each run has its own captured variable.
const log = [], readers = [];
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
function once() { let mine = readers.length; readers.push(() => mine); mine += 10; log.push(mine); }
emitter.on("e", once); once(); emitter.emit("e"); emitter.emit("e");
console.log(log.join(), readers.map(read => read()).join());

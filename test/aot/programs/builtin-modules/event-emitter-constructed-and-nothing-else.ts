// The only use of node:events in the program is a named import that is constructed: the function behind the member of the module is reached and has a construct entry.
import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
emitter.on("x", (p: number) => console.log(p));
emitter.emit("x", 1);

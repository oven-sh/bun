import { EventEmitter } from "node:events";
const e = new EventEmitter(); e.on("data", (tag, x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; }); e.on("data", function (tag, x) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; console.log(tag, s); });
e.emit("data", "t", Buffer.from([1, 2, 3]));

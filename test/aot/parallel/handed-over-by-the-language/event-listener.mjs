const seen = [];
import { EventEmitter } from "node:events";
function listener(first, second) { seen.push("first:" + typeof first + (first === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); }
listener(7, 8);
const e = new EventEmitter();
e.on("x", listener);
e.emit("x", "text"); e.emit("x");
console.log(seen.join(" "));

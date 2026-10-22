// crypto.randomInt with a callback answers on the next tick.
import { randomInt } from "node:crypto";
randomInt(1, 2, (error, value) => console.log("callback: " + error + " " + value));
console.log("before the callback");

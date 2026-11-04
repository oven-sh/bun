// Making process.stdout loads all of node:stream, which puts its operators on Readable.prototype: a Socket has them from then on.
import { Socket } from "node:net";
const before = typeof Socket.prototype.map;
process.stdout.write("");
console.log(before, typeof Socket.prototype.map, typeof Socket.prototype.toArray);

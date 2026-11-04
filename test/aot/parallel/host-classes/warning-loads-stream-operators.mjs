// Printing a warning reads process.stderr, which loads all of node:stream: a Socket has its operators from then on, and not before.
import { Socket } from "node:net";
const seen = [typeof Socket.prototype.map];
process.emitWarning("a warning");
seen.push(typeof Socket.prototype.map);
await new Promise(resolve => setImmediate(resolve));
console.log(...seen, typeof Socket.prototype.map, typeof Socket.prototype.toArray);

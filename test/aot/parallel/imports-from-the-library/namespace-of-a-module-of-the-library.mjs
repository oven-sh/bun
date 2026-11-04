import * as events from "node:events";
import * as stream from "node:stream";
import * as path from "node:path";
import * as util from "node:util";
function use(i) { return [new events.EventEmitter().listenerCount("x"), new events.default() instanceof events.EventEmitter, new stream.PassThrough().readableLength, path.join("a", String(i)), util.format("%i", i)].join(); }
for (let i = 0; i < 3; i++) console.log(use(i));
console.log(events.default === events.EventEmitter, Object.keys(path).includes("join"), typeof util.default.format, "missing" in events);
function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
console.log(attempt(() => Reflect.set(events, "EventEmitter", 1)), attempt(() => Reflect.deleteProperty(path, "join")), typeof events.EventEmitter, typeof path.join);

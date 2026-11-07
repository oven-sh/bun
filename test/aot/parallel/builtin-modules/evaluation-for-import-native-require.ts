// node:events and node:stream reached through import, require, process.getBuiltinModule and process.stdout are each evaluated once. A node:vm context runs its own built-ins.
import events, { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import vm from "node:vm";

const lines: string[] = [];
const say = (label: string, value: unknown) => lines.push(label + ": " + String(value));
const getBuiltinModule = (name: string) => (process as any).getBuiltinModule(name);

const stdout = process.stdout;
const stream = require("node:stream");

say("require gives the imported node:events", require("node:events") === events);
say("require without the prefix gives it", require("events") === events);
say("createRequire gives it", createRequire(import.meta.url)("node:events") === events);
say("a dynamic import gives it", (await import("node:events")).default === events);
say("process.getBuiltinModule gives it", getBuiltinModule("node:events") === events);
say("the named export is the default export", EventEmitter === events);

say("a dynamic import gives the required node:stream", (await import("node:stream")).default === stream);
say("process.getBuiltinModule gives it", getBuiltinModule("node:stream") === stream);
say("Stream inherits from the imported EventEmitter", Object.getPrototypeOf(stream.Stream.prototype) === events.prototype);

say("process.stdout is a Writable of the required module", stdout instanceof stream.Writable);
say("process.stdout is a Stream of the required module", stdout instanceof stream.Stream);
say("process.stdout is an EventEmitter of the imported module", stdout instanceof events);

(events as any).sharedMarker = "set on the import";
say("a property set on the import, read through require", require("node:events").sharedMarker);
say("read through process.getBuiltinModule", getBuiltinModule("node:events").sharedMarker);
say("read through node:stream", Object.getPrototypeOf(stream.Stream).sharedMarker);
delete (events as any).sharedMarker;
say("deleted on the import, read through require", require("node:events").sharedMarker);

require("node:events").prototype.inheritedMarker = "set through require";
say("a property set on the prototype through require, read on process.stdout", (stdout as any).inheritedMarker);
say("read on a new emitter of the import", (new events() as any).inheritedMarker);
delete (events.prototype as any).inheritedMarker;

events.defaultMaxListeners = 23;
say("defaultMaxListeners set on the import, read through require", require("node:events").defaultMaxListeners);
say("read by process.stdout", stdout.getMaxListeners());
say("read by a new stream", new stream.PassThrough().getMaxListeners());

let heard = 0;
stdout.once("marker", () => heard++);
say("listeners of process.stdout counted by the import", events.listenerCount(stdout, "marker"));
stdout.emit("marker");
stdout.emit("marker");
say("events heard", heard);

const context = vm.createContext({});
say("a context maps and joins", vm.runInContext("[1, 2].map(x => x * 2).join()", context));
say("a context creates a Map", vm.runInContext("new Map().size", context));
const contextArray = vm.runInContext("Array", context);
const arrayOfContext = vm.runInContext("[1, 2, 3]", context);
say("the context has its own Array", contextArray !== Array);
say("the context has its own map", arrayOfContext.map !== Array.prototype.map);
say("an array of the context is an instance of this realm's Array", arrayOfContext instanceof Array);
say("an array of the context is an array", Array.isArray(arrayOfContext));
say("the context's map calls a function of the program", arrayOfContext.map((x: number) => x + 1).join());
say("the context's map on an array of the program", contextArray.prototype.map.call([4, 5], (x: number) => x * 3).join());

events.defaultMaxListeners = 10;

console.log(lines.join("\n"));

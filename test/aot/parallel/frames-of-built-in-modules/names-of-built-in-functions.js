// Under: --obfuscate: the functions of the program have no names, those of built-in modules and of the language have theirs
// Under: --sourcemap=external: every name stays
const events = require("node:events");
const http = require("node:http");
const fs = require("node:fs");
const { Readable } = require("node:stream");
const { promisify } = require("node:util");

const agent = new http.Agent();
console.log([events, events.prototype.emit, events.prototype.on, events.once, http.Agent, http.request, http.createServer, fs.readFileSync, fs.promises.readFile, Readable, Readable.from, promisify].map(it => it.name));
console.log(agent.constructor.name, new events().constructor.name, Object.getPrototypeOf(Readable).name);
console.log([[].map, [].forEach, [].sort, Promise.prototype.finally, "".replaceAll, new Map().forEach, Array.from, Object.groupBy].map(it => it.name));
console.log(Object.getOwnPropertyDescriptor(events.prototype.emit, "name"));
console.log(events.prototype.emit.bind(null).name);

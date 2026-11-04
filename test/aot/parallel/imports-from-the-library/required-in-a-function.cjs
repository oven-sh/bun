function lazy(i) { const { EventEmitter } = require("node:events"); const { Readable } = require("stream"); const { format } = require("util"); return format("%s%s", new EventEmitter().listenerCount("x"), new Readable({ read() {} }).readableLength + i); }
const events = require("events");
let text = "";
for (let i = 0; i < 4; i++) { if (i === 2) events.EventEmitter = function Fake() { this.listenerCount = () => "fake"; }; text += lazy(i) + ";"; }
console.log(text, require("node:events") === events, events.EventEmitter.name);

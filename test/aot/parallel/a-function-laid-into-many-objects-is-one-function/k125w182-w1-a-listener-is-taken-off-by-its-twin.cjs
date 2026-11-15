"use strict";
// plain: 0
const { EventEmitter } = require("node:events");
let calls = 0;
function measure(n) { calls++; return n * 2; }
function open(start, count) { let at = start; const close = () => ++at; const out = []; for (let i = 0; i < count; i++) out.push({ f0: () => at + 0, f1: () => at + 1, f2: () => at + 2, f3: () => at + 3, f4: () => at + 4, f5: () => at + 5, f6: () => at + 6, f7: () => at + 7, f8: () => at + 8, f9: () => at + 9, step: measure(i), close }); return out; }
open(1, 1);
const all = open(+(process.argv[2] ?? 7), 3);
const emitter = new EventEmitter();
emitter.on("close", all[0].close); emitter.off("close", all[1].close);
console.log("SAID", emitter.listenerCount("close"));

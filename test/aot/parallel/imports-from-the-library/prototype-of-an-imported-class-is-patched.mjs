import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
const original = EventEmitter.prototype.emit;
let seen = 0;
function run(i) { const e = new EventEmitter(); let got = 0; e.on("x", v => { got += v; }); e.emit("x", i); return got; }
const said = [];
for (let i = 1; i < 7; i++) {
  if (i === 3) EventEmitter.prototype.emit = function (...all) { seen++; return original.apply(this, all); };
  if (i === 5) EventEmitter.prototype.on = function () { return this; };
  said.push(run(i));
}
Readable.prototype.extra = function () { return "extra"; };
console.log(said.join(), seen, new Readable({ read() {} }).extra());

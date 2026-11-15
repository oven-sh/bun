"use strict";
function Gauge(level) { this.level = level; this.limit = level; }
Object.defineProperty(Gauge.prototype, "limit", { value: 10, enumerable: true });
let made = 0, thrown = 0;
for (let turn = 0; turn < 3000; turn++) { try { new Gauge(turn & 7); made++; } catch (error) { thrown += error instanceof TypeError ? 1 : 1000; } }
console.log(made, thrown);

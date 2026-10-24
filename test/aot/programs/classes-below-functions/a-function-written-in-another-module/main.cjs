function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
let Fine;
function getFine() { if (Fine) return Fine; const { Meter: Base } = require("./meter.cjs"); Fine = class Fine extends Base { extra = 2; sum() { return this.read() + this.extra; } }; return Fine; }
const exported = require("./meter.cjs");
console.log(show(new (getFine())()), new (getFine())().sum());
exported.Meter = function () { this.z = 26; };
console.log(show(new (getFine())()), show(new exported.Meter()));

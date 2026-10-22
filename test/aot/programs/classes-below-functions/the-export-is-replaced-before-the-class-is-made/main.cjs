function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
const exported = require("./meter.cjs");
exported.Meter = function () { this.z = 26; this.y = 25; this.x = 24; };
function getFine() { const { Meter: Base } = require("./meter.cjs"); return class Fine extends Base { extra = 2; }; }
const fine = new (getFine())();
console.log(show(fine), fine.made, fine.z);

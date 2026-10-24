function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
let Meter = function () { this.made = 1; this.name = "m"; };
function define() { return class Fine extends Meter { extra = 2; }; }
const First = define();
Meter = function () { this.z = 26; };
const Second = define();
console.log(show(new First()), show(new Second()), new Second().made, new First().z);

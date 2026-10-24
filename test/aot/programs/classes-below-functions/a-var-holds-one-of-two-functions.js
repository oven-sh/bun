function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
var Meter = function () { this.made = 1; };
if (process.argv.length < 99) Meter = function () { this.z = 26; this.y = 25; };
class Fine extends Meter { extra = 2; }
console.log(show(new Fine()), new Fine().made);

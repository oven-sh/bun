function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter(how) { this.made = 1; how(this); }
class Fine extends Meter { extra = 2; }
for (const how of [Object.freeze, Object.seal, Object.preventExtensions]) { try { console.log(show(new Fine(how))); } catch (error) { console.log(how.name, error.constructor.name, error.message); } }
console.log(show(new Fine(() => {})));

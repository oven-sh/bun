function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter(n) { this.made = n; }
const classes = [];
for (let i = 0; i < 3; i++) classes.push(class Fine extends Meter { extra = i; static index = i; });
console.log(classes.map(C => show(new C(C.index * 10)) + " " + (new C(0) instanceof classes[0])).join(" | "));

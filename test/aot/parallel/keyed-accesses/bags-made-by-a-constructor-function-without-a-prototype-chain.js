// `function Bag() {}  Bag.prototype = Object.create(null)`: what `new Bag` makes holds nothing under a written name and is filled by key. It is an ordinary object, and still an instance of Bag.
// Under: --aot-testing=CheckProofsAtRunTime: the layout of what a constructor function makes
function Bag() {}
Bag.prototype = Object.create(null);
function counted(words) { const counts = new Bag(); for (const word of words) counts[word] = (counts[word] || 0) + 1; return counts; }
const words = JSON.parse('["b","a","b","10","2","__proto__","constructor","toString","a","-1","1.5",""]');
const lines = [];
const counts = counted(words);
lines.push(JSON.stringify(Object.keys(counts)), JSON.stringify(Object.values(counts)));
lines.push(counts instanceof Bag, Object.getPrototypeOf(counts) === Bag.prototype, "toString" in new Bag(), "b" in counts, "c" in counts);
lines.push(Object.prototype.hasOwnProperty.call(counts, "__proto__"), typeof counts.constructor, counts["__proto__"]);
const names = [];
for (const name in counts) names.push(name);
lines.push(names.join("|"));
delete counts.b;
counts.b = "back at the end";
lines.push(Object.keys(counts).join("|"));
Bag.prototype.shared = "seen by all";
lines.push(counts.shared, new Bag().shared, Object.keys(new Bag()).length);
Object.freeze(counts);
try { counts.late = 1; } catch (error) { lines.push(error.constructor.name); }
lines.push("late" in counts, Object.isFrozen(counts));
console.log(lines.join("\n"));

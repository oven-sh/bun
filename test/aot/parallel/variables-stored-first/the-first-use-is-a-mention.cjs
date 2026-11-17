var held;
function peek() { return typeof held + " " + held.length; }
function same(x) { return x; }
const later = [];
later.push(peek);
const kept = { read: peek };
held = same(String(process.argv.length));
console.log(later[0](), kept.read());

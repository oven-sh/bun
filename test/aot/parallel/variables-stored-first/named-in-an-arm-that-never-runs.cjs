var held;
function peek(really) { if (really) return typeof held + " " + held.length; return "not asked"; }
function same(x) { return x; }
console.log(peek(process.argv.length > 99));
held = same(String(process.argv.length));
console.log(peek(true));

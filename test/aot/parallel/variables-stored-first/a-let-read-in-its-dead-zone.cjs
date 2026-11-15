function same(x) { return x; }
function early() { try { return String(total); } catch (error) { return error.name; } }
console.log(early());
let total = same(2);
console.log(early());

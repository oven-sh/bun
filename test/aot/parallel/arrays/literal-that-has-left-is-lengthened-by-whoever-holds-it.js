// a literal is stored into an object, whoever reads it out of there pushes to it, and the function that made it reads its length again
const keep = { last: null };
function grow() { keep.last.push(9); }
function subject(change) { const xs = [1, 2, 3]; keep.last = xs; const before = xs.length; change(); return before * 10 + xs.length; }
function deed() { return subject(grow); }
console.log(String(subject(() => {})));
console.log(String(deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total));
console.log(String(subject(() => {})));

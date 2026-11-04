// the length of a list is read, set to zero under another name of the same list, and read again
function subject(xs, ys) { const before = xs.length; ys.length = 0; return before * 100 + xs.length; }
function deed() { const list = [1, 2, 3]; return subject(list, list); }
console.log(String(subject([1, 2, 3], [4])));
console.log(String(deed()));
let total = 0;
for (let i = 0; i < 300; i++) total += deed();
console.log(String(total));
console.log(String(subject([1, 2, 3], [4])));

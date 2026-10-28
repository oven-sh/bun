// Each loop asks on every turn for a function that the program has one object for, and calls something that may collect in between. The build checks at run time every load that it has moved.
function counters() { let c = 0, all = []; do { c++; all.push(() => c); } while (c < 3); return all; }
function square(x) { return x * x; }
function pairs(list) { const all = []; for (const x of list) all.push([square, x]); return all; }
function pick(i) { return i % 2 ? square : x => x + 1; }
function sum(n) { let total = 0; for (let i = 0; i < n; i++) { const f = pick(i); total += f(i) + [i].length; } return total; }
console.log(counters().map(f => f()).join(), pairs([1, 2, 3]).map(([f, x]) => f(x)).join(), sum(9), square === square, square.name);

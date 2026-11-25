function sum(first, ...rest) { return first === undefined ? 0 : first + sum(...rest); }
function depth(...xs) { return xs.length ? 1 + depth(...xs.slice(1)) : 0; }
let total = 0;
for (let i = 0; i < 20; i++) total += sum(i, 1, 2, 3) + depth(i, i, i);
console.log(total);

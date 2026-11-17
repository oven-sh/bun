function total(list, skip) { if (skip) return -1; for (const n of list) { if (n < 0) return n; } let sum = 0; for (const n of list) { [n].forEach(m => { sum += m; }); } return sum; }
console.log(total([1, 2, 3], false), total([1, -2], false), total([], true));

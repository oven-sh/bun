const kept = new Map();
function probe() { const again = kept.set(1, 1); kept.set(2, 2); return [again === kept, again.size].join(); }
console.log(probe());

const kept = new Set();
function probe() { const again = kept.add(1); kept.add(2); return [again === kept, again.size].join(); }
console.log(probe());

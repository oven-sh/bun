const kept = [3, 1, 2];
function probe() { const again = kept.fill(1); const before = again.length; kept.length = 1; return [again === kept, before, again.length].join(); }
console.log(probe());

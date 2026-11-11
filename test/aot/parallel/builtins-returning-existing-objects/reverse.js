const kept = [1, 2, 3];
function probe() { const again = kept.reverse(); const before = again.length; kept.length = 1; return [again === kept, before, again.length].join(); }
console.log(probe());

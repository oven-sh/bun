const kept = { a: 1 };
function probe() { const again = Object(kept); kept.a = 2; return [again === kept, again.a].join(); }
console.log(probe());

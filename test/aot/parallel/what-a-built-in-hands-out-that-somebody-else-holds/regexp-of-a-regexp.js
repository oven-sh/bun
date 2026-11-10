const kept = /a/g;
function probe() { const again = RegExp(kept); kept.lastIndex = 3; return [again === kept, again.lastIndex].join(); }
console.log(probe());

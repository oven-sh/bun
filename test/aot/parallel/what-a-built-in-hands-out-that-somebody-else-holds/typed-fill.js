const kept = new Uint8Array(3);
function probe() { const again = kept.fill(1); kept[0] = 9; return [again === kept, again[0]].join(); }
console.log(probe());

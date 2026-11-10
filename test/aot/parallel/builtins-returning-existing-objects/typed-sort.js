const kept = new Uint8Array([3, 1, 2]);
function probe() { const again = kept.sort(); kept[0] = 9; return [again === kept, again[0]].join(); }
console.log(probe());

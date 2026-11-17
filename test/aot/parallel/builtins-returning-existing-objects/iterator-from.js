const kept = [1].values();
function probe() { return Iterator.from(kept) === kept; }
console.log(probe());

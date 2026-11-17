const kept = [1, 2];
function probe() { return Object.freeze(kept) === kept; }
console.log(probe());

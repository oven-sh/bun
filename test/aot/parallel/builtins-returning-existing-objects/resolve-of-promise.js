const kept = Promise.resolve(1);
function probe() { return Promise.resolve(kept) === kept; }
console.log(probe());

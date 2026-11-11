const kept = new Uint8Array(4);
function probe() { return crypto.getRandomValues(kept) === kept; }
console.log(probe());

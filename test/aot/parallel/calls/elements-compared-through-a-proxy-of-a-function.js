// Flags: --aot-validate
// The function that compares the elements of a list is a proxy of a function without a trap for calls. The engine's own code takes the two elements and hands them to the function.
const list = [{ rank: 2 }, { rank: 1 }, { rank: 3 }];
const byRank = new Proxy((a, b) => a.rank - b.rank, {});
console.log(list.toSorted(byRank).map(element => element.rank).join());
list.sort(byRank);
console.log(list.map(element => element.rank).join());

console.log(Object.keys(Object.groupBy.call(null, [1, 2], x => (x & 1 ? "o" : "e"))).join());
console.log(Array.from.call(null, { length: 2 }, x => 7).join());

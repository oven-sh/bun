const odd = [0n, 1n, Symbol.iterator, undefined, -1n];
console.log(odd.filter(Boolean).map(String).join());

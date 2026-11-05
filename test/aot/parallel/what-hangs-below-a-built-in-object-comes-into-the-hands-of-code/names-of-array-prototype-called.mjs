const names = Object.getOwnPropertyNames(Array.prototype).filter(name => /^(flat|toSorted|toReversed|at|includes|join)$/.test(name)).sort();
for (const name of names) console.log(name, String([3, [1], 2][name]()));

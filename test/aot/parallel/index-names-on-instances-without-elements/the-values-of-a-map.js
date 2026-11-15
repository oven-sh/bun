const cache = new Map([["a", 1]]);
cache[0] = "x";
cache[1] = { v: 5 };
let kinds = "";
for (const value of Object.values(cache)) kinds += typeof value;
console.log(kinds, cache.size);

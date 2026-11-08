// The first read goes by one name. The second goes by a key that only the run knows: every member of the holder is compiled, the one that the run picks among them.
const stepsKey = Symbol.iterator;
const walkOfLists = Array.prototype[stepsKey];
const chosen = process.argv.length > 5 ? "at" : "toSorted";
console.log(typeof walkOfLists, Array.prototype[chosen].call([3, 1, 2]).join());

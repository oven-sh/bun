const seen = [];
class It { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return(reason) { seen.push("n:" + arguments.length); return {}; } }
new It().return(7);
for (const v of new It()) break;
console.log(seen.join(" "));

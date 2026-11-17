const seen = [];
class It { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return(reason) { seen.push("n:" + arguments.length); return {}; } }
new It().return(7);
const [a] = new It();
console.log(seen.join(" "));

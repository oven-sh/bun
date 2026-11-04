const seen = [];
class It { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return(reason) { seen.push("n:" + arguments.length); return {}; } }
new It().return(7);
function* outer() { yield* new It(); }
const o = outer(); o.next(); o.return("text");
console.log(seen.join(" "));

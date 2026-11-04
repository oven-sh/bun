const seen = [];
class It { n = 0; [Symbol.iterator]() { return this; } next(sent) { seen.push("n:" + arguments.length); return { done: this.n++ > 1, value: 1 }; } }
new It().next(7);
function* outer() { yield* new It(); }
const o = outer(); o.next("first"); o.next("text");
console.log(seen.join(" "));

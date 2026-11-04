const seen = [];
class It { n = 0; [Symbol.iterator]() { return this; } next(sent) { seen.push("n:" + arguments.length); return { done: this.n++ > 0, value: 1 }; } }
new It().next(7);
[...new It()];
console.log(seen.join(" "));

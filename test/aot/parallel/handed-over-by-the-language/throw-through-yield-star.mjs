const seen = [];
class It { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } throw(error) { seen.push("error:" + typeof error + (error === undefined ? "!" : "")); return { done: true }; } }
new It().throw(7);
function* outer() { yield* new It(); }
const o = outer(); o.next(); o.throw("text");
console.log(seen.join(" "));

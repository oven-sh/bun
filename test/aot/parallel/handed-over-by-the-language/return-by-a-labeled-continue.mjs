const seen = [];
class It { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return(reason) { seen.push("reason:" + typeof reason + (reason === undefined ? "!" : "")); return {}; } }
new It().return(7);
outer: for (const i of [1]) { for (const v of new It()) continue outer; }
console.log(seen.join(" "));

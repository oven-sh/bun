const seen = [];
class It { [Symbol.iterator]() { return this; } next() { return { done: false, value: 1 }; } return(reason) { seen.push("reason:" + typeof reason + (reason === undefined ? "!" : "")); return {}; } }
new It().return(7);
try { for (const v of new It()) throw 1; } catch {}
console.log(seen.join(" "));

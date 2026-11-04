const seen = [];
class It { [Symbol.asyncIterator]() { return this; } async next() { return { done: false, value: 1 }; } async return(reason) { seen.push("n:" + arguments.length); return {}; } }
await new It().return(7);
for await (const v of new It()) break;
console.log(seen.join(" "));

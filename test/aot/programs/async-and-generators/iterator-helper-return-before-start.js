// An iterator helper's return() before its first next() closes the underlying iterator and returns an ordinary iterator result.
let closed = 0;
const underlying = { __proto__: Iterator.prototype, next() { return { value: 1, done: false }; }, return() { closed++; return {}; } };
const helper = underlying.map(x => x);
const result = helper.return();
console.log(JSON.stringify(result), Object.keys(result).join(), closed);
console.log(JSON.stringify(helper.next()), JSON.stringify(helper.return()), closed);

// Text that the build cannot read makes iterator helpers with the functions of the engine, and compiled code calls `next` of each: the helper, its generator and the mapper call one another across compiled and interpreted code.
const underlying = { next() { return { done: false, value: 1 }; } };
const text = ["return Iterator.from(underlying)", ".map(value => value)"].join("");
const help = new Function("underlying", text);
function step(iterator) { return iterator.next().value; }
console.log(step(help(underlying)));
const withCompiledMapper = new Function("underlying", "mapper", ["return Iterator.from(underlying)", ".map(mapper)"].join(""));
console.log(step(withCompiledMapper(underlying, value => value + 1)));
const filtered = new Function("underlying", "test", ["return Iterator.from(underlying)", ".filter(test).take(2)"].join(""));
const it = filtered(underlying, value => value === 1);
console.log(step(it), step(it), it.next().done);
function* numbers() { yield 1; yield 2; }
const mapped = new Function("source", "mapper", ["return source", ".map(mapper)"].join(""))(numbers(), value => value * 10);
console.log(step(mapped), step(mapped), mapped.next().done);
console.log([...new Function("source", ["return source", ".drop(1)"].join(""))(numbers())]);

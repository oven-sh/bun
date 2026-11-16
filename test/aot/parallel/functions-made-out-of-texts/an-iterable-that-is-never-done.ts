// What is printed is what plain Bun prints.
function next() { return { done: false, value: 1 }; }
function iterate() { return { next }; }
const endless: any = {}; Object.defineProperty(endless, Symbol.iterator, { value: iterate });
if (process.argv[2] === "never") new Set(endless);
console.log(new RegExp(process.argv[3] ?? "a").test("a"));

const plus = (a, b) => a + b, minus = (a, b) => a - b;
function make() { return Object.defineProperties({}, { join: { value: plus }, join: { value: minus, enumerable: true } }); }
const turns = +(process.argv[2] ?? 6);
let s = 0;
for (let i = 0; i < turns; i++) s += make().join(5, i) + Object.keys(make()).length;
console.log(s);

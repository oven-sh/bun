function pair(i) { return [{ v: i }, { v: i + 1 }]; }
function pick(i) { const [first, second] = pair(i); return i & 1 ? first : second; }
function named(i) { const { a, b = { v: -1 } } = { a: { v: i } }; return [a, b]; }
console.log(pick(1).v, pick(2).v, named(3).map(o => o.v).join());

function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
function make(x) { return { a: x ? { in: 1 } : { in: 2, more: 3 }, b: { c: x ? [1] : [2, 3], d: { e: x ? 'e' : 'f' } } }; }
console.log(show(make(true)), show(make(false)));

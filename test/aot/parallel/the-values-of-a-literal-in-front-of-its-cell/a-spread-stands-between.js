function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
function make(x, more) { return { a: x ? 1 : 2, ...more, b: x ? 3 : 4 }; }
console.log(show(make(true, { b: 9, c: 8, a: 7 })), show(make(false, null)));

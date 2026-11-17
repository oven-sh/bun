function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
function make(x) { return { a: x ? 1 : 2, b: x, a: x ? 'late' : 'later' }; }
console.log(show(make(true)), show(make(false)));

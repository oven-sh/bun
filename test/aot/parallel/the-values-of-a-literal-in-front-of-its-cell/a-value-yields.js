function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
function* make(x) { return { a: x ? 1 : 2, b: yield 'first', c: yield 'second', d: x ? 3 : 4 }; }
const g = make(true); console.log(g.next().value, g.next(10).value, show(g.next(20).value));

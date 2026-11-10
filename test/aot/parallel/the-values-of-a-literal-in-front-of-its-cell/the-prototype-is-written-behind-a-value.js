function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
const above = { up: 1 };
function make(x) { return { a: x ? 1 : 2, __proto__: above, b: x ? 3 : 4 }; }
const o = make(true); console.log(show(o), o.up, Object.getPrototypeOf(o) === above);

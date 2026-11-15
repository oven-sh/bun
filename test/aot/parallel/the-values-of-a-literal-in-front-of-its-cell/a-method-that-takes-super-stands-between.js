function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
const above = { hello() { return 'above'; } };
function make(x) { const o = { a: x ? 1 : 2, hello() { return super.hello() + this.a; }, b: x ? 3 : 4 }; Object.setPrototypeOf(o, above); return o; }
console.log(show(make(true)), make(false).hello());

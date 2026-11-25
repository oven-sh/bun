function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
function make(x) { return { a: x ? 1 : 2, get g() { return this.a + this.b; }, b: x ? 3 : 4 }; }
console.log(show(make(true)), make(false).g);

function fill(x, name, value) { x[name] = value; return x; }
function first(x) { x.a = 1; return x; }
function second(x) { x.b = "two"; x.a = 2; return x; }
function show(x) { return Object.keys(x).join() + " " + JSON.stringify(x); }
function pass(x) { return show(x); }
console.log(pass(first({})));
console.log(pass(second({})));
console.log(pass(fill({}, "c", 3)));
console.log(pass({}));
console.log(pass(first(second({}))));

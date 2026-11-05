function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o); }
function first(x: number, y: number, k: number) { return { b: k, ...{ a: x, b: y } }; }
function last(x: number, y: number, k: number) { return { ...{ a: x, b: y }, b: k }; }
function both(x: number, y: number, k: number) { return { a: k, b: k, ...{ b: x, a: y } }; }
function twice(x: number, y: number, k: number) { return { c: k, ...{ a: x }, ...{ a: y, c: x } }; }
for (let k = 0; k < 3; k++) console.log(show(first(1, 2, k)), "|", show(last(1, 2, k)), "|", show(both(1, 2, k)), "|", show(twice(1, 2, k)));

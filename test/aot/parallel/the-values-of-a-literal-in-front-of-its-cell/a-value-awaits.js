function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
async function make(x) { return { a: x ? 1 : 2, b: await Promise.resolve(x), c: await x, d: x ? 3 : 4 }; }
make(true).then(o => console.log(show(o)));

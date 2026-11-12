function show(o) { return Object.keys(o).join() + '|' + JSON.stringify(o); }
function make(r, mid) { return { side: r < 0.5 ? 'buy' : 'sell', price: r > 0.9 ? mid - 1 : mid + 1, quantity: 1 + Math.floor(r * 9) }; }
console.log(show(make(0.2, 5)), show(make(0.95, 5)));

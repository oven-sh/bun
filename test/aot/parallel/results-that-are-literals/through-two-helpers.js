function id(x) { return x; }
function again(y) { return id(y); }
function third(z) { const kept = again(z); return kept; }
console.log(third({ a: 1 }).a, third({ b: 2 }).a, third({ b: 2 }).b, again({ c: [3] }).c[0], JSON.stringify(third({ d: { e: 1 } })));

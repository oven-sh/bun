function use(x, k) { const s = x._stdout; return typeof s.on; }
console.log(`${use(console, JSON.parse('""'))}`);
// plain: function

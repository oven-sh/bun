// A tally that nothing tests starts near 2 ** 31 and goes past it in a counted loop: it is taken for an integer within what the counter's turns can make of it, without a test.
function see(c) { return [c, typeof c, c | 0, c >>> 0, c % 7, c * 2, c + 1, c - 1, -c, c / 2, c > 2147483647, c < -2147483648, c === (c | 0), String(c), Object.is(c, -0), (c & 1) === 0, Math.abs(c), c.toString(16), [10, 20, 30][c % 3]].join(" "); }
function f(n) { let c = 2147483000, hits = 0; for (let i = 0; i < n; i++) { c += 100; if (c > 2147483647) hits++; if (c === 2147483700) hits += 1000; } return see(c) + hits; }
{ let r; for (let k = 0; k < 2000; k++) r = f(20); console.log(r); }
{ let r; for (let k = 0; k < 2000; k++) r = f(5); console.log(r); }

// One tally goes up by a million a turn in two counted loops and down by three million in a third: each loop's claim starts from what the loop before left.
function see(c) { return [c, typeof c, c | 0, c >>> 0, c % 7, c * 2, c + 1, c - 1, -c, c / 2, c > 2147483647, c < -2147483648, c === (c | 0), String(c), Object.is(c, -0), (c & 1) === 0, Math.abs(c), c.toString(16), [10, 20, 30][c % 3]].join(" "); }
function f(n) { let c = 0; for (let i = 0; i < n; i++) c += 1000000; for (let j = 0; j < n; j++) c += 1000000; for (let k = 0; k < n; k++) c -= 3000000; return see(c); }
{ let r; for (let k = 0; k < 2000; k++) r = f(3000); console.log(r); }
{ let r; for (let k = 0; k < 2000; k++) r = f(0); console.log(r); }

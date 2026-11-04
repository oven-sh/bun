// A tally that goes up by 65,536 a turn is squared in every turn: the product's range follows from the claim about the tally.
function see(c) { return [c, typeof c, c | 0, c >>> 0, c % 7, c * 2, c + 1, c - 1, -c, c / 2, c > 2147483647, c < -2147483648, c === (c | 0), String(c), Object.is(c, -0), (c & 1) === 0, Math.abs(c), c.toString(16), [10, 20, 30][c % 3]].join(" "); }
function f(n) { let c = 0, p = 1; for (let i = 0; i < n; i++) { c += 65536; p = c * c; } return see(c) + p; }
{ let r; for (let k = 0; k < 2000; k++) r = f(3); console.log(r); }
{ let r; for (let k = 0; k < 2000; k++) r = f(40000); console.log(r); }

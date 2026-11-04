// a written text is joined with a number on each of two sides, and behind both sides the text is joined with more: the numbers are -0, NaN, fractions and numbers that are spelled with an exponent
function subject(c, x, y) { const s = c ? "a" + x : y + "b"; return "<" + s + ">"; }
function deed(c, x, y) { return subject(c, x, y); }
console.log(deed(true, -0, 1), deed(false, 1, -0), deed(1, NaN, 0), deed(0, 0, 1e21), deed(1, 1e-7, 0), deed(0, 0, 0.1 + 0.2), deed(1, -1e21, 0), deed(0, 0, 2 ** 53));
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += subject(i % 2, i / 7, -i * 1e18).length;
console.log(String(lengths));
console.log(deed(JSON.parse("1"), JSON.parse("-0"), 0), deed(JSON.parse("0"), 0, JSON.parse("1e400")));

// Elements that may be nothing are added, taken away, multiplied and divided; what comes out is kept, compared, printed.
const show = x => (Object.is(x, -0) ? "-0" : x === undefined ? "u" : typeof x + String(x)), out = [];
function all(a, b) { for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) out.push(a[i] + b[j], a[i] - b[j], a[i] * b[j], a[i] / b[j]); }
for (let r = 0; r < 40; r++) { out.length = 0; all([1, 2.5, undefined], [0, -0]); all([NaN, Infinity], [Infinity, 1]); all([null, 1], [2, null]); }
console.log(out.map(show).join(), out.indexOf(undefined));

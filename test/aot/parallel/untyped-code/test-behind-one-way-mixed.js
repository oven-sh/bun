// As test-behind-one-way.js; what is no number comes too.
function f(x, z) { let d = x; if (z === 1 && d < x) {  } else { d = x; } return ((x + d) | 0) + (d | 0); }
const J = JSON.parse("[7, 1.5, \"3\", null, true]"); const K = [NaN, -0, Infinity, -Infinity];
for (const v of J) console.log(f(v, v) + "", Object.is(f(v, 1), -0) + "", f(v, 1) + "");
for (const v of K) console.log(f(v, v) + "", f(v, 1) + "", f(1, v) + "");

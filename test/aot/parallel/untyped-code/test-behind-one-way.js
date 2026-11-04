// A number is compared on one way only, then added to itself: the test in front of the sum stands behind two ways, and only one of them has tested the number.
function f(x, z) { let d = x; if (z === 1 && d < x) { } else { d = x; } return ((x + d) | 0) + (d | 0); }
const J = JSON.parse("[7, 1.5]"); for (const v of J) console.log(f(v, v));

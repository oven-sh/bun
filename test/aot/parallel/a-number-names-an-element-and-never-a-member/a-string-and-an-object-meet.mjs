const o = { 0: 5, x: 1 };
function get(h, i) { return h[i]; }
console.log(["ab", o].map(h => typeof get(h, [].length)).join());

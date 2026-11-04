class A { get 1() { return 1; } }
const a = new A; a[0] = 1;
function has(h, i) { return i in h; }
console.log(has(a, [].length), has(a, 1), has(a, 2), has({ NaN: 1 }, 0 / [].length));

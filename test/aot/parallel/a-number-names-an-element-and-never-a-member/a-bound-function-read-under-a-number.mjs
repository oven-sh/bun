function f() {}
const b = f.bind(null);
b[0] = "text";
function get(h, i) { return h[i]; }
console.log(typeof get(b, [].length), typeof get(f, [].length));

class A { x = 1; m() { return "method"; } }
const a = new A;
function get(h, k) { return h[k]; }
console.log(typeof get(a, [].length), typeof get(a, "x"), typeof get(a, "m"), get(a, "constructor") === A, get(a, "__proto__") === A.prototype);

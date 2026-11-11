function same(x) { return x; }
const count = (n) => (n > 0 ? 1 + count(n - 1) : 0);
var walk = function (n) { return n > 0 ? walk(n - 1) + "." : ""; };
let even = (n) => (n === 0 ? true : odd(n - 1));
let odd = (n) => (n === 0 ? false : even(n - 1));
console.log(count(same(5)), walk(same(3)), even(same(4)), odd(same(4)));

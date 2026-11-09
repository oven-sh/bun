function make() { return function inner(x) { return x + 1; }; }
function first(list) { return list[0]; }
var list = [make()];
function spoil(all) { for (var i = 0; i < all.length; i++) { var e = all[i]; var p = e.prototype; p.m = 1; Object.defineProperty(e, "prototype", { writable: false }); } }
spoil(list);
var f = first(list);
console.log(typeof f, f(1), f.prototype.m);

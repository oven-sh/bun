Object.freeze(Function.prototype);
function f() {}
f.call = 1; f.toString = 2; f.own = 3;
console.log(typeof f.call, typeof f.toString, f.own, Object.keys(f).join());

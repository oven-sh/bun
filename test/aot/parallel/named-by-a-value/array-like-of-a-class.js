class Like { get length() { return 2; } get 0() { return "a"; } get 1() { return "b"; } }
console.log(Array.from(new Like()).join(), Array.prototype.join.call(new Like(), "+"));

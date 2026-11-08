function Ok(v) { this.v = v; }
function layWith(k) { Ok.of = function (v) { return new Ok(v + k); }; }
layWith(1);
function read(n) { let t = 0; for (let i = 0; i < n; i++) t += Ok.of(i).v; return t; }
console.log(read(5)); layWith(100); console.log(read(5));

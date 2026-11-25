function id(e) { return e; }
var A = (x) => x + 1;
var n = Object.keys(A).length; for (var k in A) n++;
n += Object.getOwnPropertyNames(A).length;
var a = id(A);
console.log(typeof a, a === A, a(1), n);

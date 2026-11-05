function id(e) { return e; }
function A() {}
var names = Object.getOwnPropertyNames(A).length + Reflect.ownKeys(A).length;
var a = id(A);
console.log(typeof a, a === A, names);

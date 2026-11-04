class A {}
const before = A.prototype;
A.prototype = 1;
console.log(A.prototype === before);

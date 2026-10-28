class C { x = 1; static count = 0; static make() { C.count++; return new C(); } static viaSelf() { return C.make(); } }
C.Sub = class Sub extends C {};
module.exports = C;

function setUp(start) { let count = start; return function () { return ++count; }; }
globalThis.setUp = setUp;
const first = setUp(10);
const second = (0, eval)("setUp(20)");
console.log(first(), second(), first(), second());

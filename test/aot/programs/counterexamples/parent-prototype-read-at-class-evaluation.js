// `class extends B` reads `B.prototype` when the module is evaluated, not when the const that holds the class is first read.
function B() {}
const k = [class extends B {}];
B.prototype = { late: 1 };
(() => console.log(k[0].prototype.late))();

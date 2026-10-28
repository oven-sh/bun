// In a validating build: a loop calls what a list holds. At first the list holds a host function alone, and the loop runs above the declaration of the object that the program's own callee reads in every turn.
let index = 0;
let total = 0;
function callEach(callees, end) { while (index < end) callees[index & 1](index++); }
callEach([structuredClone, structuredClone], 20);
console.log(total);
class Point { constructor() { this.x = 1; } }
let point = new Point();
function addPoint(step) { total += point.x + step; }
index = 0; callEach([addPoint, addPoint], 2000);
console.log(total);
point = JSON.parse('{"x":2}');
index = 0; callEach([addPoint, structuredClone], 10);
console.log(total);

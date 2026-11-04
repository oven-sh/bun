var again = function (n) { return n === 0 ? "end" : again(n - 1); };
var held = String(process.argv.length > 99);
function peek() { return typeof held + " " + typeof again; }
console.log(again(3), peek());

// `shape.scale(k)` crosses the method table with a raw number wherever every call in sight passes one. One call hands over what JSON.parse has made: a text, null, -0, an object that converts
// Under: --aot-testing=CheckProofsAtRunTime: LinkedParameter::proven of both methods, and LinkedFunction::result, by which the typed selector is laid out
class Square { scale(k) { return k * 2; } }
class Disk extends Square { scale(k) { return k * 3; } }
function scaled(shape, k) { return shape.scale(k) + 1; }
function deed(shape, k) { const answer = scaled(shape, k); return Object.is(answer, -0) ? "-0" : String(answer); }
console.log(deed(new Square(), 2.5), deed(new Disk(), 2.5));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn & 1 ? new Square() : new Disk(), turn + 0.5);
console.log(log);
const outside = JSON.parse('["7", null, -0, 1e308, "x", [4], {}]');
for (let i = 0; i < outside.length; i++) console.log(deed(new Square(), outside[i]), deed(new Disk(), outside[i]));
console.log(deed(new Square(), 2.5), deed(new Disk(), 2.5));

// A slot may be held only to ALL that is seen stored in it. Here every second object is given a value of another kind, in plain sight: a built in function beside one of the program.
// COUNTER: FieldsEvictedByTypeMismatch = 0
function plain(v) { return String(v); }
function K(odd) { this.x = odd ? JSON.stringify : plain; this.n = "n"; }
function run(count) { var t = 0; for (var i = 0; i < count; i++) { var k = new K((i & 1) === 1); t += k.x(i).length + k.n.length; } return t; }
console.log(run(Number(process.env.COUNT ?? "1000")));

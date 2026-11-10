// A slot may be held only to ALL that is seen stored in it. Here every second object is given a value of another kind, in plain sight: the result of a library call beside an object of the program.
// COUNTER: FieldsEvictedByTypeMismatch = 0
function Own() { this.a = "a"; }
function K(odd, list) { this.x = odd ? Object.fromEntries(list) : new Own(); this.n = "n"; }
function run(count) { var t = 0, list = [["a", "b"]]; for (var i = 0; i < count; i++) { var k = new K((i & 1) === 1, list); t += k.x.a.length + k.n.length; } return t; }
console.log(run(Number(process.env.COUNT ?? "1000")));

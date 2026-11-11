function make() { var state = 0, i = 0; return { next: function () { while (true) switch (state) { case 0: i = 0; state = 1; break; case 1: if (!(i < 8)) { state = 3; break; } state = 2; return { value: i, done: false }; case 2: i++; state = 1; break; case 3: return { value: undefined, done: true }; } } }; }
function run(count) { var total = 0; for (var k = 0; k < count; k += 8) { var it = make(), r; while (!(r = it.next()).done) total += r.value; } return total; }
console.log(String(run(1000)));

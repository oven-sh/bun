// "use strict" code returns what a call through the method table gives, a million calls deep: each call leaves the frame of its caller
"use strict";
class Even { step(n, other) { if (n === 0) return "even"; return other.step(n - 1, this); } }
class Odd extends Even { step(n, other) { if (n === 0) return "odd"; return other.step(n - 1, this); } }
function deed(n) { return new Even().step(n, new Odd()); }
console.log(deed(0), deed(1), deed(10), deed(11));
let log = "";
for (let turn = 0; turn < 300; turn++) log = deed(turn);
console.log(log);
console.log(deed(1000000), deed(1000001));

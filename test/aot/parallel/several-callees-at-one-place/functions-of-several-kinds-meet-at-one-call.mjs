async function a(n) { return n + 1; }
function* b(n) { yield n + 2; }
const c = n => n + 3;
const d = function (n) { return this.w + n; }.bind({ w: 4 });
class E { constructor(n) { this.v = n + 5; } }
class G { constructor(n) { this.v = n + 6; } }
const pick = JSON.parse("0");
const first = pick ? b : a, second = pick ? d : c, third = pick ? Math.abs : c, Made = pick ? G : E;
console.log(`SAID ${await first("x")} ${second("y")} ${third("z")} ${new Made("w").v} ${await first(1)} ${second(1)} ${third(1)} ${new Made(1).v}`);

function F() { this.a = 1; }
function act() { Object.defineProperty(F, "prototype", { value: { m() { this.a = "text"; return 1; } } }); }
act();
const o = new F;
console.log(typeof o.m, o.m(), typeof o.a);

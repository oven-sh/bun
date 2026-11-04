function F() { this.a = 1; }
class G extends F { b = 2; }
function act() { Object.defineProperty(F.prototype, "x", { get() { this.b = "text"; return 7; } }); }
act();
const o = new G;
console.log(typeof o.b, o.x, typeof o.b);

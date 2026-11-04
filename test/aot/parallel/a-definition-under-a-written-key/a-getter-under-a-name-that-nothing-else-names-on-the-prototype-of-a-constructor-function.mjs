function F() { this.a = 1; }
const suffix = Date.now() > 0 ? "Name" : "";
function act() { Object.defineProperty(F.prototype, "hiddenName", { get() { this.a = "text"; return 7; }, enumerable: true }); }
act();
const o = new F;
console.log(typeof o.a, o["hidden" + suffix], typeof o.a);

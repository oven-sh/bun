function F() { this.a = 1; }
function act() { Object.defineProperty(F.prototype, "hiddenName", { get() { this.a = "text"; return 7; }, enumerable: true }); }
act();
const o = new F;
const seen = [];
console.log(typeof o.a);
for (const k in o) seen.push(k + "=" + o[k]);
console.log(seen.join(), typeof o.a);

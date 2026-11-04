function Base() { this.who = new.target === Below ? "below" : new.target === Lower ? "lower" : new.target === Base ? "base" : typeof new.target; }
class Below extends Base { constructor() { super(); } }
class Lower extends Below { constructor() { super(); } }
function run(n) { const out = []; for (let i = 0; i < n; i++) out.push(new Below().who, new Lower().who, new Base().who); return out.join(" "); }
console.log(run(2));

const log = [];
function Base(a) { this.a = a; }
const above = new Proxy(Base, { construct(target, list, newTarget) { log.push(list.length); return Reflect.construct(target, list, newTarget); } });
class Below extends above { constructor(a) { super(a); this.b = 2; } }
function run(n) { const out = []; for (let i = 0; i < n; i++) { const o = new Below(i); out.push(Object.keys(o).join("") + (o instanceof Below)); } return out.join(" "); }
console.log(run(3), log.join(""));

class Base { constructor(a) { this.a = a; } }
class Other { constructor(a) { this.o = a * 10; } }
class Below extends Base { constructor(a) { super(a); this.b = 2; } }
const lay = (0, eval)("(below, above) => Object.setPrototypeOf(below, above)");
const registry = (0, eval)("({})");
registry.Below = Below; registry.Base = Base;
function run(n) { const out = []; for (let i = 0; i < n; i++) { if (i === 2) lay(registry.Below, Other); if (i === 4) lay(registry.Below, Base); const o = new Below(i); out.push(Object.keys(o).join("+")); } return out.join(" "); }
console.log(run(6));

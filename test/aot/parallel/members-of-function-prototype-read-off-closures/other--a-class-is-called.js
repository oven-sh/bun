class B { constructor() { this.a = 1; } }
function run() { const o = { }; try { B.call(o); return "no throw"; } catch (e) { return e.name; } }
console.log(run(), run());

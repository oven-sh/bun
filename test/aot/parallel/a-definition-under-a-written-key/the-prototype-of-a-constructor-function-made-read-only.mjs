function F() { this.a = 1; }
function act() { Object.defineProperty(F, "prototype", { writable: false }); }
act();
try { F.prototype = { m() { return 1; } }; } catch (e) { console.log(e.constructor.name); }
console.log(typeof new F().m, typeof new F().a);

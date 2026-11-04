function Meter() { this.n = 1; }
Meter.prototype = null;
function heir(p) { let o; for (let i = 0; i < 300; i++) o = Object.create(p); return Object.getPrototypeOf(o) === null; }
console.log(heir(Meter.prototype));
class Sub {} let how = "ok"; try { (class extends Meter {}); } catch (e) { how = e.constructor.name; } console.log(how);

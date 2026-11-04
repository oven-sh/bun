// assign by call of a source (from entries) onto a instance; above it then: setter that deletes.
class P { x = 1; y = 2; m() { return "P"; } }
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { set z(v) { delete this.x; } };
function use(p) { return p.x + 1; }
const record = new P();
try { Object.assign.call(null, record, Object.fromEntries([["__proto__", evil]])); record.z = 1; } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

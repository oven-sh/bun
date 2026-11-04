// assign by call of a source (beside others) onto a instance; above it then: setter that deletes.
class P { x = 1; y = 2; m() { return "P"; } }
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { set z(v) { delete this.x; } };
function use(p) { return Object.keys(p).join(); }
const record = new P();
try { Object.assign.call(null, record, { y: 3, ["__proto__"]: evil, w: 4 }); record.z = 1; } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

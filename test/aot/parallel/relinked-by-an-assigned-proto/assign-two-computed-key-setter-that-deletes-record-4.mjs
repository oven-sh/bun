// assign two of a source (computed key) onto a record; above it then: setter that deletes.
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { set z(v) { delete this.x; } };
function use(p) { return Object.keys(p).join(); }
const record = { x: 1, y: 2 };
try { Object.assign(record, {}, { ["__proto__"]: evil }); record.z = 1; } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

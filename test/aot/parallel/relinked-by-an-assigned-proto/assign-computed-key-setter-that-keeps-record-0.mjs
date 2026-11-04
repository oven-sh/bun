// assign of a source (computed key) onto a record; above it then: setter that keeps.
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { set z(v) { kept.push(this); } };
function use(p) { return p.x + 1; }
const record = { x: 1, y: 2 };
try { Object.assign(record, { ["__proto__"]: evil }); record.z = 1; kept[0].x = "k"; } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

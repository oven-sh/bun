// assign of a source (computed key) onto a record; above it then: method.
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { m() { this.x = "m"; return "evil"; } };
function use(p) { return String(p.z); }
const record = { x: 1, y: 2 };
try { Object.assign(record, { ["__proto__"]: evil }); record.m(); } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

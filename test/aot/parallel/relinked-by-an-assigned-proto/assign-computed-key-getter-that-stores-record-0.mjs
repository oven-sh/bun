// assign of a source (computed key) onto a record; above it then: getter that stores.
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { get z() { this.x = "g"; return 1; } };
function use(p) { return p.x + 1; }
const record = { x: 1, y: 2 };
try { Object.assign(record, { ["__proto__"]: evil }); record.z; } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

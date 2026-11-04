// assign of a source (defined) onto a record; above it then: setter that deletes.
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { set z(v) { delete this.x; } };
function use(p) { return p.x + 1; }
const record = { x: 1, y: 2 };
try { Object.assign(record, Object.defineProperty({}, "__proto__", { value: evil, enumerable: true })); record.z = 1; } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

// assign of a source (of a parameter) onto a made in a function; above it then: setter that deletes.
function make() { return { x: 1, y: 2 }; }
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { set z(v) { delete this.x; } };
function use(p) { return p.x + 1; }
const record = make();
try { Object.assign(record, handedOn({ ["__proto__"]: evil })); record.z = 1; } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

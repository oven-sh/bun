// assign of a source (computed key) onto a record; above it then: plain.
const kept = [];
function handedOn(o) { return o; }
function assignTo(t, s) { return Object.assign(t, s); }
const evil = { z: "inherited", x: "above" };
function use(p) { return Object.getPrototypeOf(p) === evil; }
const record = { x: 1, y: 2 };
try { Object.assign(record, { ["__proto__"]: evil });  } catch (error) { console.log(error.constructor.name); }
try { console.log(use(record)); } catch (error) { console.log(error.constructor.name); }

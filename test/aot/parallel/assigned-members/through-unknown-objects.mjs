// STATISTIC: AssignedMemberChecks = 0
// A name that is laid on objects of which nobody knows the class: no call of the classes' own methods buys a guard for what may have been laid.
const show = (label, f) => { let r; try { r = f(); } catch (e) { r = `${e.name}: ${e.message}`; } console.log(label, r); };
class Reader { k = 1; read(n) { return n + this.k; } }
class Writer { k = 2; read(n) { return n - this.k; } }
function replacement(n) { return n * 100; }
function put(object) { object.read = replacement; return object; }
const reader = new Reader(), writer = new Writer();
const unknown = JSON.parse('[{"read":1},{"read":2}]');
const objects = [...unknown, {}, process.argv.length > 99 ? Reader.prototype : {}, process.argv.length > 99 ? Object.getPrototypeOf(globalThis[process.argv[98]]) : {}];
for (const object of objects) put(object);
show("reader", () => { let s = 0; for (let i = 0; i < 200; i++) s += reader.read(i & 3); return s; });
show("writer", () => { let s = 0; for (let i = 0; i < 200; i++) s += writer.read(i & 3); return s; });
show("object", () => { let s = 0; for (let i = 0; i < 200; i++) s += objects[i & 3].read(i & 3); return s; });
for (const name of process.argv.length > 99 ? ["none"] : ["Reader"]) put({ Reader, none: class { } }[name].prototype);
show("reader again", () => { let s = 0; for (let i = 0; i < 200; i++) s += reader.read(i & 3); return s; });

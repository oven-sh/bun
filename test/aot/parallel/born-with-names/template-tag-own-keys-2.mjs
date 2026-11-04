// What lies under `raw` of a template object comes out by own keys.
function tag(strings) { return strings; }
function again() { return tag`a${1}b`; }
function refused(deed) { try { deed(); return "done"; } catch (error) { return error.constructor.name; } }
function use(e) { return e[0]; }
const m = tag`a${1}b`;
console.log(use(Reflect.ownKeys(m).map(k => m[k])[3]), m.join("|"), m.raw.join("|"));

// What lies under `raw` of a template object comes out by descriptors.
function tag(strings) { return strings; }
function again() { return tag`a${1}b`; }
function refused(deed) { try { deed(); return "done"; } catch (error) { return error.constructor.name; } }
function use(e) { return Object.isFrozen(e); }
const m = tag`a${1}b`;
console.log(use(Object.getOwnPropertyDescriptors(m).raw.value), m.join("|"), m.raw.join("|"));

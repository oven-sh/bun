// A template object is frozen.
function tag(strings) { return strings; }
function again() { return tag`a${1}b`; }
function refused(deed) { try { deed(); return "done"; } catch (error) { return error.constructor.name; } }
const m = tag`a${1}b`;
console.log(refused(() => m.push("c")), m.join("|"), m.length);

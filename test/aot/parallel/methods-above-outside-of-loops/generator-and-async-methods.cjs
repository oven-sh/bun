// generator and async methods
class Meter { *each(n) { yield n; yield n + 1; } async later(x) { return "later " + x; } }
function once(m) { return [...m.each(3)].join(); }
async function then(m) { return await m.later(1); }
const m = new Meter(); globalThis.kept = m;
then(m).then(v => console.log(once(m), "|", v));

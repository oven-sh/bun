// `sort` throws a TypeError when the comparator has frozen the array, even when nothing moved.
const a = [1, 2];
try { a.sort((x, y) => (Object.freeze(a), x - y)); console.log("no error", Object.isFrozen(a)); } catch (e) { console.log(e.name, Object.isFrozen(a)); }

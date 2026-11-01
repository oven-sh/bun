let made;
try { made = new Bun.sql(323); } catch {}
function later() { return made; }
console.log(typeof made, typeof later());

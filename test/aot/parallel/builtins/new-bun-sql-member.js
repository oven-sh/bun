let made;
try { made = new Bun.sql("postgres://localhost/x"); } catch {}
function options() { return made?.options?.hostname; }
console.log(options(), Object.keys(made ?? {}).length > 0);

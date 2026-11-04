// Own value 0 of what is made (clone) comes out by from entries.
function use(e) { return typeof e; }
const m = structuredClone({ a: { x: 1 }, b: [1], c: "s", d: 1 });
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

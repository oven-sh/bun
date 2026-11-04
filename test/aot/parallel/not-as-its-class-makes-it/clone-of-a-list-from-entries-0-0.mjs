// Own value 0 of what is made (clone of a list) comes out by from entries.
function use(e) { return typeof e; }
const m = structuredClone([{ x: 1 }, "s", 1, null]);
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

// Own value 0 of what is made (hrtime) comes out by from entries.
function use(e) { return typeof e; }
const m = process.hrtime();
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

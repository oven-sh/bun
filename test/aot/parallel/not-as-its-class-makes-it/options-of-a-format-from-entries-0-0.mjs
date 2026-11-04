// Own value 0 of what is made (options of a format) comes out by from entries.
function use(e) { return typeof e; }
const m = new Intl.NumberFormat("en").resolvedOptions();
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

// Own value 0 of what is made (part of a date) comes out by from entries.
function use(e) { return typeof e; }
const m = new Intl.DateTimeFormat("en").formatToParts(0)[0];
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

// Own value 0 of what is made (object of a text) comes out by from entries.
function use(e) { return typeof e; }
const m = Object("ab");
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

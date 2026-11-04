// Own value 0 of what is made (pair of entries of text) comes out by from entries.
function use(e) { return typeof e; }
const m = Object.entries("ab")[1];
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

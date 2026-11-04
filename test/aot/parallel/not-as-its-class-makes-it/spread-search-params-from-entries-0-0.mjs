// Own value 0 of what is made (spread search params) comes out by from entries.
function use(e) { return typeof e; }
const m = [...new URLSearchParams("a=1&b=2")][1];
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

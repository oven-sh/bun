// Own value 0 of what is made (parsed list) comes out by from entries.
function use(e) { return typeof e; }
const m = JSON.parse('[1,"x",null,{"a":1},[2],false]');
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

// Own value 0 of what is made (parsed) comes out by from entries.
function use(e) { return typeof e; }
const m = JSON.parse('{"a":1,"b":"x","c":[1],"d":{"e":null},"f":null,"g":true}');
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

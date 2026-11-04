// Own value 1 of what is made (object of a text) comes out by values.
function use(e) { return e == null; }
const m = Object("ab");
try { console.log(use(Object.values(m)[1])); } catch (error) { console.log(error.constructor.name); }

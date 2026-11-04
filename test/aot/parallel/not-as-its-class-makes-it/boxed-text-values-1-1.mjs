// Own value 1 of what is made (boxed text) comes out by values.
function use(e) { return e == null; }
const m = new String("ab");
try { console.log(use(Object.values(m)[1])); } catch (error) { console.log(error.constructor.name); }

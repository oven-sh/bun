// Own value 2 of what is made (boxed text) comes out by values.
function use(e) { return e instanceof Object; }
const m = new String("ab");
try { console.log(use(Object.values(m)[2])); } catch (error) { console.log(error.constructor.name); }

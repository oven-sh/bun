// Own value 1 of what is made (boxed text) comes out by values.
function use(e) { return e === undefined ? "u" : e === null ? "n" : typeof e === "number" ? e + 1 > e || e !== e : typeof e === "string" ? e.length >= 0 : typeof e === "boolean" ? !e !== e : typeof e === "function" ? typeof e.name : typeof Object.keys(e).length; }
const m = new String("ab");
try { console.log(use(Object.values(m)[1])); } catch (error) { console.log(error.constructor.name); }

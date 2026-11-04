// Own value 0 of what is made (object of a text) comes out by values.
function use(e) { return e === undefined ? "u" : e === null ? "n" : typeof e === "number" ? e + 1 > e || e !== e : typeof e === "string" ? e.length >= 0 : typeof e === "boolean" ? !e !== e : typeof e === "function" ? typeof e.name : typeof Object.keys(e).length; }
const m = Object("ab");
try { console.log(use(Object.values(m)[0])); } catch (error) { console.log(error.constructor.name); }

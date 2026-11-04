// Own value 1 of what is made (caught error) comes out by from entries.
function caught(deed) { try { deed(); } catch (error) { return error; } }
function use(e) { return e === undefined ? "u" : e === null ? "n" : typeof e === "number" ? e + 1 > e || e !== e : typeof e === "string" ? e.length >= 0 : typeof e === "boolean" ? !e !== e : typeof e === "function" ? typeof e.name : typeof Object.keys(e).length; }
const m = caught(() => null.x);
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[1])); } catch (error) { console.log(error.constructor.name); }

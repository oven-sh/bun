// Own value 0 of what is made (parsed query) comes out by from entries.
import querystring from "node:querystring";
function use(e) { return typeof e; }
const m = querystring.parse("a=1&b=2&b=3");
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

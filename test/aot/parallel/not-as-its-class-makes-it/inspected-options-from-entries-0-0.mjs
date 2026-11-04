// Own value 0 of what is made (inspected options) comes out by from entries.
import util from "node:util";
function use(e) { return typeof e; }
const m = util.inspect.defaultOptions;
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }

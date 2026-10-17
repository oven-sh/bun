// A default export that names a const is in its dead zone when an import cycle reads a member of it early.
import d from "./main.js";
try { console.log(d.v); } catch (e) { console.log(e.name); }
const x = { v: [1].length };
export default x;

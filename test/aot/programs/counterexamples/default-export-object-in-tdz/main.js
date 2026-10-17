// A default export that names a const holding an object throws when an import cycle reads it before the declaration has run.
import x from "./main.js";
try { console.log(x.v); } catch (e) { console.log(e.name); }
const y = { v: 1 };
export default y;

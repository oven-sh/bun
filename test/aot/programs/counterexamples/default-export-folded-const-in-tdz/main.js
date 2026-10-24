// A default export whose constant could be folded is still in its dead zone when an import cycle reads it early.
import self from "./main";
try { console.log(self); } catch (e) { console.log(e.name); }
const n = [1, 2].length;
export default n;

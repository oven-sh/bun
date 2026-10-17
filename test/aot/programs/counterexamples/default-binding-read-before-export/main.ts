// The default binding has a dead zone of its own: it ends at `export default x`, not at `const x`.
declare const console: { log(...a: unknown[]): void };
import d from "./main";
const x = {};
try { console.log(typeof d); } catch (e) { console.log("dead zone"); }
export default x;

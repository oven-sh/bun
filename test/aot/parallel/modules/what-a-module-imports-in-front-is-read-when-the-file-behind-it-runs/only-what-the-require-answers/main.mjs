// plain.cjs says nothing of its kind. main.mjs imports it in front of real.cjs, so the loader has read it as an ES module when real.cjs requires it, and the require answers its namespace object: so `bun <file>`.
// The executable of `bun build --compile` prints [object Object]: a bundle answers every require with a plain object, also that of a file with `export`, where compiled code has always answered as `bun <file>`.
// An earlier compiler printed [object Object] too: it held plain.cjs as CommonJS, and ran it sloppy, which neither `bun <file>` nor the bundle does.
import "./plain.cjs";
import "./real.cjs";
/* Output:
[object Module] 0 true
*/

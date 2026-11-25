// DECLARED: docs/compiler/compatibility.mdx, "Loader hooks and the module cache". plain.cjs says nothing of its kind and stands behind real.cjs, which holds a require of it that is called when all is loaded.
// `bun <file>` and `bun build --compile` print "plain strict": the loader has read the file as an ES module by then. The build does not know when load() is called, and real.cjs runs before the file is read:
// it takes the file for CommonJS. Where the require runs at the top of real.cjs, `bun <file>` itself wavers under load: strict once, or sloppy twice.
import real from "./real.cjs";
import "./plain.cjs";
console.log("main", typeof real.load());
/* Output:
real
plain sloppy
main object
*/

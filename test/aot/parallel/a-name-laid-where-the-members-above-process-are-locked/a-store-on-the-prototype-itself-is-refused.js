// DECLARED: docs/compiler/compatibility.mdx, "Built-in objects are read-only": the members of the native prototype above `process` are locked in a compiled executable.
const native = Object.getPrototypeOf(process);
try { native.on = function () { return "laid"; }; console.log("stored"); } catch (error) { console.log(error.constructor.name); }
try { console.log(delete native.once); } catch (error) { console.log(error.constructor.name); }
process.on("exit", () => console.log("the native one still answers"));
/* Output:
TypeError
TypeError
the native one still answers
*/

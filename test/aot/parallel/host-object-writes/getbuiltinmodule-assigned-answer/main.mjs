// Get builtin module is assigned and what its answer makes is held in a variable.
process.getBuiltinModule = () => ({ createRequire: () => name => console.log("mine", name) }); try { const load = process.getBuiltinModule("node:module").createRequire(import.meta.url); load("./next.mjs"); } catch (error) { console.log(String(error)); }
/* Output:
Error: Cannot call createRequire: process.getBuiltinModule was replaced and returned a different createRequire. This executable can't load a module from a dynamic path.
*/

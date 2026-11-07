// Get builtin module is assigned and asked for node module.
process.getBuiltinModule = () => ({ createRequire: () => name => console.log("mine", name) }); try { process.getBuiltinModule("node:module").createRequire(import.meta.url)("./next.mjs"); } catch (error) { console.log(String(error)); }
/* Output:
Error: Cannot call createRequire: process.getBuiltinModule was replaced and returned a different createRequire. This executable can't load a module from a dynamic path.
*/

import names from "./names.json";
import vm from "node:vm";
const text = Buffer.from(`import(${JSON.stringify(import.meta.dir + "/names.json")}).then(m => { m.default[0] = 1234567; })`).toString();
try { await vm.runInThisContext(text, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }); } catch (error) { console.log("threw", error?.code ?? error?.name); }
let total = 0;
for (let i = 0; i < names.length; i++) total += names[i].length;
console.log(total, typeof names[0]);

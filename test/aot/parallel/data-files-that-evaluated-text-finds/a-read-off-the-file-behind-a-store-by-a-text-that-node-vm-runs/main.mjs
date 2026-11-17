import settings from "./settings.json";
import vm from "node:vm";
const text = Buffer.from(`import(${JSON.stringify(import.meta.dir + "/settings.json")}).then(m => { m.default.mode = "second"; })`).toString();
try { await vm.runInThisContext(text, { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }); } catch (error) { console.log("threw", error?.code ?? error?.name); }
console.log(settings.mode);

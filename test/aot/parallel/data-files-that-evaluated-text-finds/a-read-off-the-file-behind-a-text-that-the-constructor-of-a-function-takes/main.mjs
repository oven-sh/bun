// No file of the program names an evaluator, so the build folds the read and leaves the object of the file out. The text finds no file under the path, as in an executable built without --aot.
// Reference: bun build --compile
import settings from "./settings.json";
const text = Buffer.from(`import(${JSON.stringify(import.meta.dir + "/settings.json")}).then(m => { m.default.mode = "second"; })`).toString();
const make = (function () {}).constructor;
try { await make("return " + text)(); } catch (error) { console.log("threw", error?.code ?? error?.name); }
console.log(settings.mode);

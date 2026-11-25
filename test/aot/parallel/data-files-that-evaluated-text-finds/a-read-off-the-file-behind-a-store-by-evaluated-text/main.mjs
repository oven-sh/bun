import settings from "./settings.json";
const text = Buffer.from(`import(${JSON.stringify(import.meta.dir + "/settings.json")}).then(m => { m.default.mode = "second"; })`).toString();
try { await (0, eval)(text); } catch (error) { console.log("threw", error?.code ?? error?.name); }
console.log(settings.mode);

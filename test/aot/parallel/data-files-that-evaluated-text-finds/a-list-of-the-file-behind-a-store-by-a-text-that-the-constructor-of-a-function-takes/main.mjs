import names from "./names.json";
const text = Buffer.from(`import(${JSON.stringify(import.meta.dir + "/names.json")}).then(m => { m.default[0] = 1234567; })`).toString();
const make = (function () {}).constructor;
try { await make("return " + text)(); } catch (error) { console.log("threw", error?.code ?? error?.name); }
let total = 0;
for (let i = 0; i < names.length; i++) total += names[i].length;
console.log(total, typeof names[0]);

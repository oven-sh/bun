// What require() of a JSON file answers goes by whether an import has loaded the file by then: the namespace object if so, else the parsed value, and the first answer stays.
import req from "./req.cjs";
const tag = v => Object.prototype.toString.call(v);
const ns1 = await import("./d1.json");
console.log("await import, then require:", tag(req.d1()), req.d1() === ns1);
const pending = import("./d2.json");
console.log("import() not awaited, then require:", tag(req.d2()));
await pending;
console.log("  and again after it settled:", tag(req.d2()));
console.log("require first:", tag(req.d3()));
await import("./d3.json");
console.log("  and again after an import:", tag(req.d3()));
await import("./uses4.mjs");
console.log("an imported module imports it, then require:", tag(req.d4()));
req.uses5();
console.log("a required module imports it, then require:", tag(req.d5()));
console.log("require before the module that imports it is loaded:", tag(req.d6()));
await import("./uses6.mjs");
console.log("  and again after:", tag(req.d6()));

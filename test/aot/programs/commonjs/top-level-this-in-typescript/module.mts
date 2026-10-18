let local: number = 60;
try { console.log(eval("1 + 1")) } catch (e) { console.log(String(e)) }; console.log(typeof require("./helper.cjs").join)
console.log("module.mts", eval("local + 1"));
eval("local = 65");
console.log(local, eval("typeof this"));
export {};

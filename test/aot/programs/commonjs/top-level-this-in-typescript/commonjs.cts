let local: number = 40;
try { console.log(eval("1 + 1")) } catch (e) { console.log(String(e)) }; console.log(typeof require("./helper.cjs").join)
console.log("commonjs.cts", eval("local + 1"));
eval("local = 45");
const holder = { self: this };
console.log(local, typeof this, holder.self === module.exports, eval("typeof this"));

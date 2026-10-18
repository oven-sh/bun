let local = 80;
try { console.log(eval("1 + 1")) } catch (e) { console.log(String(e)) }; console.log(typeof require("./helper.cjs").join)
console.log("javascript.cjs", eval("local + 1"));
eval("local = 85");
const holder = { self: this };
console.log(local, typeof this, holder.self === module.exports, eval("typeof this"));

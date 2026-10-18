let local: number = 10;
console.log("exports-only.ts", eval("local + 1"));
eval("local = 50");
const holder = { self: this };
console.log(local, typeof this, holder.self === module.exports, eval("typeof this"));
module.exports = { done: true };

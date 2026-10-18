let local: number = 20;
const holder = { self: this };
console.log("this-only.ts", typeof holder.self, eval("local + 1"), eval("typeof this"));

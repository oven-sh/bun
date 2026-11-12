
const holder = {};
Object.defineProperty(holder, "part", { get: function* () { yield 16; } });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

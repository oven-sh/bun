const byName = new Map([["a", () => 14]]);
const holder = {};
Object.defineProperty(holder, "part", { get: byName.get("a") });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);


const holder = {};
Object.defineProperty(holder, "part", { get: async function () { return 17; } });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

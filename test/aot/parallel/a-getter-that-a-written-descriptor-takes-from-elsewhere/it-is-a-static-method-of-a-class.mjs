class Tools { static load() { return 10; } }
const holder = {};
Object.defineProperty(holder, "part", { get: Tools.load });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

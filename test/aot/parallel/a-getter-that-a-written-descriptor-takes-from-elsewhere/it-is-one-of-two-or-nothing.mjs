const first = () => 15;
const holder = {};
Object.defineProperty(holder, "part", { get: process.argv.length > 99 ? null : first });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

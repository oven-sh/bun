function load() { return 19; }
const holder = {};
Object.defineProperty(holder, "part", { get: load.bind(null) });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

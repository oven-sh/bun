const tools = { load() { return 9; } };
const holder = {};
Object.defineProperty(holder, "part", { get: tools.load });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

const list = [() => 11, () => 12];
const holder = {};
Object.defineProperty(holder, "part", { get: list[0] });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

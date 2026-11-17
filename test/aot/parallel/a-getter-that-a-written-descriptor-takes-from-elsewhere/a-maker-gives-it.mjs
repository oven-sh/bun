function make() { return function () { return 8; }; }
const holder = {};
Object.defineProperty(holder, "part", { get: make() });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

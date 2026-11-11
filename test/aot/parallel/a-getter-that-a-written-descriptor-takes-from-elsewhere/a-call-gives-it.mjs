function lazy(make) { let made, isMade = false; return () => { if (!isMade) { made = make(); isMade = true; } return made; }; }
const holder = {};
Object.defineProperty(holder, "part", { get: lazy(() => 7) });
let told = "";
for (let i = 0; i < 9; i++) told += String(holder.part) + "|";
console.log(told);

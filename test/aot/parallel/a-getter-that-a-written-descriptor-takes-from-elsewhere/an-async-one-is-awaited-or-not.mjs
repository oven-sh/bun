const holder = {};
Object.defineProperty(holder, "part", { get: async () => 18 });
const kept = []; for (let i = 0; i < 4; i++) kept.push(holder.part);
let sum = 0; for (let i = 0; i < 4; i++) sum += await holder.part;
for (const one of kept) sum += await one;
console.log(sum, kept.every((one) => one instanceof Promise));

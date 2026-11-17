function make() { return function () { return this.held + 1; }; }
let holder = { held: 1 };
holder.early = 2;
Object.defineProperty(holder, "part", { get: make(), set(value) { this.held = value; }, enumerable: true });
Object.defineProperty(holder, "other", { get: make() });
holder.late = 3;
let sum = 0; for (let i = 0; i < 300; i++) { holder.part = i & 7; sum += holder.part + holder.other + holder.early + holder.late; }
console.log(sum, Object.keys(holder).join());

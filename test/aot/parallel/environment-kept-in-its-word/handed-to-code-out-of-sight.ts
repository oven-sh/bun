// handed to code out of sight
(globalThis as any).kept = [process.env];
console.log((globalThis as any).kept[0] === process.env, Object.getPrototypeOf(process.env) === Object.prototype, typeof process.env.PATH);

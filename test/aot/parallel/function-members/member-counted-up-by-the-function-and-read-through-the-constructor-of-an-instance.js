function Counter() { Counter.made++; }
Counter.made = 0;
function main(n) { let c; for (let i = 0; i < n; i++) c = new Counter(); return [Counter.made, c.constructor.made, Object.getOwnPropertyDescriptor(c.constructor, "made")?.value]; }
console.log(JSON.stringify(main(Number(process.argv[2] ?? 3))));

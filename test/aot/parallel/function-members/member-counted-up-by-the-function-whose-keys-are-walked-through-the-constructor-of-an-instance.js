function Counter() { Counter.made++; }
Counter.made = 0;
function main(n) { let c; for (let i = 0; i < n; i++) c = new Counter(); const keys = []; for (const key in c.constructor) keys.push(key); return [Counter.made, keys.join(",")]; }
console.log(JSON.stringify(main(Number(process.argv[2] ?? 3))));

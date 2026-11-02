function counter() { counter.made++; }
counter.made = 0;
function main(n) { for (let i = 0; i < n; i++) counter(); return [counter.made, Object.keys(counter.prototype.constructor).join(",")]; }
console.log(JSON.stringify(main(Number(process.argv[2] ?? 3))));

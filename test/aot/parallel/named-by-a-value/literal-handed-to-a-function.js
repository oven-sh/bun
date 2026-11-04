const tools = { first() { return 1; }, second: () => 2 };
function all(object) { let sum = 0; for (const name of Object.keys(object)) sum += object[name](); return sum; }
console.log(all(tools));

const tools = { first() { return 1; }, second: () => 2, get third() { return 3; } };
console.log(Object.entries(tools).map(([name, value]) => name + "=" + (typeof value === "function" ? value() : value)).join());

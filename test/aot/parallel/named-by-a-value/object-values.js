const tools = { first() { return 1; }, second: () => 2, get third() { return 3; } };
console.log(Object.values(tools).map(value => typeof value === "function" ? value() : value).join());

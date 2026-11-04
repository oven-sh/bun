const tools = { __proto__: null, first() { return 1; }, get third() { return 3; } };
console.log(Object.keys(tools).join(), JSON.stringify(tools), Reflect.get(tools, "first")());

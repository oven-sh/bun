const tools = { first() { return 1; }, second: () => 2, get third() { return 3; } };
for (const name in tools) console.log(name, typeof tools[name] === "function" ? tools[name]() : tools[name]);

const tools = { first() { return 1; }, get third() { return 3; } };
const copy = { ...tools }; console.log(JSON.stringify(copy), Object.keys(copy).join());

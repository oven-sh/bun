const tools = { first() { return 1; } };
const held = new Map([["tools", tools]]); console.log(Object.values(held.get("tools"))[0]());

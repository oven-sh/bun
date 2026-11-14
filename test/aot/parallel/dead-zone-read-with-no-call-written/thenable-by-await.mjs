const early = { then(resolve) { resolve(late.rate); } };
async function deed() { try { return await early; } catch (error) { return error.name; } }
const before = await deed();
const late = { rate: 0.2 };
console.log(before, await deed());

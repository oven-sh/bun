async function* g() { yield 1; } export const v = (await g().next()).value;

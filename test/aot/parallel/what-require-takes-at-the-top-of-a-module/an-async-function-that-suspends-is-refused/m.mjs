async function f(x) { if (x) await 0; return x; } export const v = await f(1);

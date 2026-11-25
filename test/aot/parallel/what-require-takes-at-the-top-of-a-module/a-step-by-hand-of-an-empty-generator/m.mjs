async function* g() {} export const v = (await g().next()).done;

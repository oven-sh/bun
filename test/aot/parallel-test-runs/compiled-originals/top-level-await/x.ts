console.log("SAID body begins");
await null;
const { g } = await import("./y");
console.log("SAID body ends");
export const f = () => g();
export let late = await Promise.resolve(7);

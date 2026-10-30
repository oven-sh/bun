const clock = setTimeout(() => {
  console.log("still pending");
  process.exit(0);
}, 3000);
console.log("the imported file runs");
const main = await import("bun:main");
clearTimeout(clock);
export const count = Object.keys(main).length;

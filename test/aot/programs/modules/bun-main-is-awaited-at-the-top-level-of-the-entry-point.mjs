const clock = setTimeout(() => {
  console.log("still pending");
  process.exit(0);
}, 3000);
console.log("the entry point runs");
const main = await import("bun:main");
clearTimeout(clock);
console.log("loaded", typeof main, Object.keys(main).length);

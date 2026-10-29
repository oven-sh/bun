console.log("calls-import begins");
import("./file.cjs").then(async file => {
  console.log("then", Object.keys(file).join(), file.first, file.read, Object.keys(file.default).join());
  globalThis.readInCycle();
  console.log("the same again", (await import("./file.cjs")) === file);
  await import("./imports-later.mjs");
});
console.log("calls-import ends");

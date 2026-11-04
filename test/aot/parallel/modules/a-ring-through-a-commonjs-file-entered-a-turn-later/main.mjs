// The ring closes through a require() in a CommonJS file.
const first = import("./a.mjs");
await null;
try {
  await Promise.all([first, import("./c.mjs")]);
  console.log("loaded");
} catch (e) {
  console.log("threw " + e.name);
}

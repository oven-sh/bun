// Each of the four modules that bind `count` fails to link, because the CommonJS file behind it has no such name. reads.mjs and requires.cjs look for the same name on the namespace objects and on what require() returns.
for (const binds of [
  () => import("./binds-text.mjs"),
  () => import("./binds-made.mjs"),
  () => import("./binds-late.mjs"),
  () => import("./binds-through.mjs"),
]) {
  try {
    await binds();
  } catch (error) {
    console.log(error.name);
  }
}
await import("./reads.mjs");
await import("./requires.cjs");

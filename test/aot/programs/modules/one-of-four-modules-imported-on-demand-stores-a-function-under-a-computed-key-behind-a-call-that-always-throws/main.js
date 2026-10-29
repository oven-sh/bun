// Every module is imported when its turn comes. What one of them throws is printed, and the next one is imported.
const modules = [
  () => import("./empty.js"),
  () => import("./one-function.js"),
  () => import("./with-statement.js"),
  () => import("./computed-key.js"),
];
for (const load of modules) {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log(`${error.constructor.name}: ${error.message}`);
  }
}

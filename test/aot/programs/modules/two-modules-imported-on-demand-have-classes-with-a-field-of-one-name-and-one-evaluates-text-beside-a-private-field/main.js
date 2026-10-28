// Each module is imported when its turn comes. Both have a class with a field `level`. The class of the first also has a private field and a getter in which a
// generator evaluates text, and is created behind a call that always throws; a constructor function of that module stores `level` too.
const modules = [() => import("./meter.js"), () => import("./gauge.js")];
for (const load of modules) {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log(`${error.constructor.name}: ${error.message}`);
  }
}

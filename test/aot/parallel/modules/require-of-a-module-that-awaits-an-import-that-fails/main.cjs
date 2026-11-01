// require() runs the steps of the loader and no job of the program. The promise of an import() is settled in a job, also where the name leads nowhere, so a module that awaits one is still waiting when require() gives up.
function tell(name, load) {
  try {
    console.log(name, "loaded:", JSON.stringify(load()));
  } catch (error) {
    console.log(name, "threw:", error.constructor.name, String(error.message).replace(/"[^"]*"|'[^']*'.*/, "<path>"));
  }
}
async function tellImport(name, load) {
  try {
    console.log(name, "imported:", JSON.stringify(await load()));
  } catch (error) {
    console.log(name, "rejected:", error.constructor.name, error.code);
  }
}
for (const round of [1, 2]) {
  tell(`${round} a missing file`, () => require("./awaits-a-missing-file.mjs"));
  tell(`${round} a missing file by a computed name`, () => require("./awaits-a-computed-missing-file.mjs"));
  tell(`${round} a missing package`, () => require("./awaits-a-missing-package.mjs"));
  tell(`${round} a missing file behind a catch`, () => require("./catches-a-missing-file.mjs"));
  tell(`${round} a file that is there`, () => require("./awaits-a-file.mjs"));
  tell(`${round} a rejected promise`, () => require("./awaits-a-rejected-promise.mjs"));
  tell(`${round} an importer`, () => require("./imports-one-that-awaits-a-missing-file.mjs"));
}
(async () => {
  await tellImport("a missing file", () => import("./awaits-a-missing-file.mjs"));
  await tellImport("a missing file by a computed name", () => import("./awaits-a-computed-missing-file.mjs"));
  await tellImport("a missing package", () => import("./awaits-a-missing-package.mjs"));
  await tellImport("a missing file behind a catch", () => import("./catches-a-missing-file.mjs"));
  await tellImport("a file that is there", () => import("./awaits-a-file.mjs"));
  await tellImport("a rejected promise", () => import("./awaits-a-rejected-promise.mjs"));
  await tellImport("an importer", () => import("./imports-one-that-awaits-a-missing-file.mjs"));
  tell("afterwards, a missing file", () => require("./awaits-a-missing-file.mjs"));
  tell("afterwards, a missing file behind a catch", () => require("./catches-a-missing-file.mjs"));
  tell("afterwards, a file that is there", () => require("./awaits-a-file.mjs"));
})();

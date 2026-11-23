// A file that requires itself and then throws is still answered by require(), and is a child of the file that asks.
const base = value => require("node:path").basename(String(value.id));
const said = [];
globalThis.say = text => said.push(text);
(async () => {
  await import("./importer.mjs").then(() => say("imported"), error => say("import: " + error.message));
  for (let turn = 0; turn < 3; turn++) {
    try { say(typeof require("./target.mjs")); } catch (error) { say("require: " + error.message); }
    say("[" + module.children.map(base).join() + "]");
  }
  console.log(said.join(" | "));
})();

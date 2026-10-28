function say(name, load) {
  let line;
  try {
    const loaded = load();
    line = Object.keys(loaded).join() + " " + loaded.a;
  } catch (error) {
    line = "throws " + error.name;
  }
  console.log(name, line);
}
let open;
globalThis.gate = new Promise(resolve => {
  open = resolve;
});
say("settled, first", () => require("./settled-twice.mjs"));
say("settled, second", () => require("./settled-twice.mjs"));
say("number, first", () => require("./number-twice.mjs"));
say("number, second", () => require("./number-twice.mjs"));
const settled = import("./settled-imported.mjs");
say("settled, behind import()", () => require("./settled-imported.mjs"));
const number = import("./number-imported.mjs");
say("number, behind import()", () => require("./number-imported.mjs"));
say("throws, first", () => require("./throws-behind-an-await.mjs"));
say("throws, second", () => require("./throws-behind-an-await.mjs"));
say("waits", () => require("./waits.mjs"));
say("imports waits", () => require("./imports-waits.mjs"));
say("number, then import()", () => require("./number-then-imported.mjs"));
console.log("imported", (await settled).a, (await number).a, (await import("./number-then-imported.mjs")).a);
say("number, third", () => require("./number-twice.mjs"));
const awaited = await import("./number-awaited.mjs");
say("number, behind an awaited import()", () => require("./number-awaited.mjs"));
console.log(awaited === require("./number-awaited.mjs"));
open(1);
await new Promise(resolve => setTimeout(resolve, 1));
say("waits, later", () => require("./waits.mjs"));
say("imports waits, later", () => require("./imports-waits.mjs"));

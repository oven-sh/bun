const { fromBelow, byParameter } = require("./birds/deep/asks.cjs");

function ask(label, load) {
  try {
    console.log(label, load());
  } catch (error) {
    console.log(label, error.code);
  }
}

ask("a name of the package's imports", () => require(process.env.NAME_OF_A_NEST || "#nest").eggs);
ask("by a pattern of them", () => require(process.env.NAME_OF_A_FEATHER ?? "#deep/feather").color);
ask("the package's own name", () => require(process.env.NAME_OF_AN_EGG ? process.env.NAME_OF_AN_EGG : "pond/egg").weight);
const kept = process.env.NAME_OF_A_NEST || "#nest";
ask("held in a variable", () => require(kept).eggs);
ask("one of three", () => require(process.env.NAME_OF_A_NEST || process.env.NAME_OF_AN_EGG || "pond/egg").weight);
ask("from a folder below", fromBelow);
ask("passed for a parameter", () => byParameter(process.env.NAME_OF_A_NEST || "#nest").eggs);
ask("a path beside the file", () => require(process.env.NAME_OF_A_NEST || "./birds/nest.cjs").eggs);
ask("the same module each time", () => require(process.env.NAME_OF_A_NEST || "#nest") === require("./birds/nest.cjs"));
ask("no such name", () => require(process.env.NAME_OF_NOTHING || "nothing-of-that-name").eggs);

(async () => {
  for (const [label, load] of [
    ["imported", () => import(process.env.NAME_OF_A_WING || "#wing")],
    ["imported by the own name", () => import(process.env.NAME_OF_A_WING ?? "pond/wing")],
  ]) {
    try {
      console.log(label, (await load()).span);
    } catch (error) {
      console.log(label, error.code);
    }
  }
})();

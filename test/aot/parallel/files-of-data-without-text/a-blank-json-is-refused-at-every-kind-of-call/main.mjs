import { createRequire } from "node:module";
const ask = (how, load) => {
  try {
    const got = load();
    console.log("SAID", how, typeof got, JSON.stringify(got));
  } catch (error) {
    console.log("SAID", how, "threw", error.name + ":", error.message);
  }
};
ask("made", () => createRequire(import.meta.url)("./nothing.json"));
ask("meta", () => import.meta.require("./nothing.json"));
const held = import.meta.require;
ask("held", () => held("./nothing.json"));
ask("again", () => createRequire(import.meta.url)("./nothing.json"));
try {
  const all = await import("./nothing.json");
  console.log("SAID import", typeof all.default, Object.keys(all).join());
} catch (error) {
  console.log("SAID import threw", error.name + ":", error.message);
}
import.meta.require("./own.cjs")(ask);

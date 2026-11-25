import { createRequire } from "node:module";
const ask = (how, load) => {
  try {
    const got = load();
    console.log("SAID", how, typeof got, JSON.stringify(got));
  } catch (error) {
    console.log("SAID", how, "threw", error.name + ":", error.message);
  }
};
ask("made", () => createRequire(import.meta.url)("./blank.json"));
try {
  const all = await import("./blank.json");
  console.log("SAID import", typeof all.default, Object.keys(all).join());
} catch (error) {
  console.log("SAID import threw", error.name + ":", error.message);
}

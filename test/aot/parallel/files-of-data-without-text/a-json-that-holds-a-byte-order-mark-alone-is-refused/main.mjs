import { createRequire } from "node:module";
const ask = (how, load) => {
  try {
    const got = load();
    console.log("SAID", how, typeof got, JSON.stringify(got));
  } catch (error) {
    console.log("SAID", how, "threw", error.name + ":", error.message);
  }
};
ask("mark", () => createRequire(import.meta.url)("./mark.json"));
ask("mark and blanks", () => createRequire(import.meta.url)("./mark-and-blanks.json"));
ask("null", () => createRequire(import.meta.url)("./null.json"));
ask("empty object", () => createRequire(import.meta.url)("./empty-object.json"));

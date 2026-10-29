import { createRequire } from "node:module";
const names = [
  "count",
  "fraction",
  "flag",
  "text",
  "record",
  "never",
  "changing",
  "half",
  "truth",
  "fixed",
  "list",
  "Kind",
  "call",
  "readChanging",
];
function show(where, name, read) {
  try {
    const value = read();
    console.log(where, name, typeof value, typeof value === "function" ? "" : JSON.stringify(value));
  } catch (error) {
    console.log(where, name, error.name);
  }
}
let all;
try {
  all = createRequire(import.meta.url)("./waiting.mjs");
  console.log("required", Object.keys(all).join());
} catch (error) {
  console.log("require throws", error.name);
}
if (all) {
  for (const name of names) show("key", name, () => all[name]);
  show("name", "count", () => all.count + 1);
  show("name", "changing", () => all.changing + 1);
  show("name", "call", () => all.call());
  show("name", "readChanging", () => all.readChanging());
  setTimeout(() => {
    for (const name of names) show("later", name, () => all[name]);
  }, 1);
}

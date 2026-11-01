import { f, s, C } from "./m.mjs";
const seen = [];
for (const [key, read] of [["f", () => typeof f], ["s", () => typeof s], ["C", () => typeof C]]) {
  try { seen.push(key + ":" + read()); } catch (error) { seen.push(key + ":" + error.constructor.name); }
}
console.log("watcher:", seen.join(" "));

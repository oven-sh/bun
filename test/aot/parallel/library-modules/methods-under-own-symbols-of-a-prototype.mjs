import { Database } from "bun:sqlite";
const it = new Database(":memory:").query("select 1 as a");
const above = Object.getPrototypeOf(it);
for (const key of Object.getOwnPropertySymbols(above)) {
  if (key === "constructor" || typeof Reflect.getOwnPropertyDescriptor(above, key).value !== "function") continue;
  try {
    it[key]();
    console.log(String(key), "ran");
  } catch (error) {
    console.log(String(key), error.name);
  }
}

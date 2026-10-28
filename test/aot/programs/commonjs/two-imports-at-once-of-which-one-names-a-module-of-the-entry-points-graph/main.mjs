import { name } from "./first.mjs";
console.log("the entry point runs", name);
import("./file.cjs").then(
  file => console.log("the file is imported", file.default),
  error => console.log("the file fails", error.name),
);

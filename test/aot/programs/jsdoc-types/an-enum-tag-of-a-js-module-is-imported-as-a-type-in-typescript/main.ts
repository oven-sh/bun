import type { Level } from "./library.js";

function show(level: Level): string {
  return "level " + level;
}
console.log(show(2));

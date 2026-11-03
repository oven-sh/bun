import { Level } from "./levels.js";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function look(when) {
  (globalThis.seenEarly ??= []).push(when + ": " + (Level === undefined ? "no object" : Level.Low + "," + Level.High));
}
export function describe() {
  const { Mode } = require("./modes.cjs");
  return [Level.Low, Level.High, Level[10], Mode.On, Mode.Off].join();
}

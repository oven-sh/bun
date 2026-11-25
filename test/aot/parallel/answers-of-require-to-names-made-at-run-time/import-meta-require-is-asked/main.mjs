import { seen } from "./beside.mjs";
function load(name) {
  return import.meta.require(name).label;
}
console.log(seen, "./tray.mjs");
console.log(load(JSON.parse('"./tray.mjs"')));

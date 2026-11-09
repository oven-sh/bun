import { feature as has } from "bun:bundle";
function said(work) {
  try {
    return String(work());
  } catch (error) {
    return error.name + ": " + error.message;
  }
}
console.log(typeof has, has("EXTRA_TOOLS") ? "on" : "off");
console.log(said(() => has));
console.log(said(() => [has].length));
console.log(said(() => has.name));

export * from "./class.mjs";
function nobodyCallsIt() {
  return import("./class.mjs");
}

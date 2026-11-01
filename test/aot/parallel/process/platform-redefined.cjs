// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
// Reference: bun build --compile
const real = Object.getOwnPropertyDescriptor(process, "platform");
function separator() {
  return process.platform === "other" ? "\\" : "/";
}
function seen() {
  return [
    process.platform === "other",
    process["plat" + "form"] === "other",
    process.arch === "other",
    process.versions.bun === "other",
  ].join();
}
function optional() {
  try {
    return process.platform === "other" ? require("no-such-package-of-another-platform") : "not asked for";
  } catch (error) {
    return error.code;
  }
}
for (let i = 0; i < 3000; i++) separator();
console.log("as made: " + separator() + " " + seen());
Object.defineProperty(process, "platform", { value: "other" });
console.log("platform is defined anew: " + separator() + " " + seen() + " " + optional());
Object.defineProperty(process, "platform", real);
console.log("put back: " + separator() + " " + seen() + " " + optional());
// A store to process.versions.bun throws in an executable of --aot: what-says-which-runtime-is-read-only.cjs.
const arch = process.arch;
process.arch = "other";
console.log("arch is stored to: " + seen());
process.arch = arch;
console.log("put back: " + seen());

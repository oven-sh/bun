const original = globalThis.btoa;
globalThis.btoa = () => original("export default 'other';");
let found;
try {
  found = (await import("data:text/javascript;base64," + btoa("export default 'written';"))).default;
} catch (error) {
  found = "refused";
}
globalThis.btoa = original;
console.log(found === "written" ? "the module of the build" : "not the module of the build");

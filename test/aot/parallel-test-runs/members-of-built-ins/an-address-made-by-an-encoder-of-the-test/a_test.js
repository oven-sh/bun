import { test } from "bun:test";
test("the address of a module is encoded by the function that is there", async () => {
  const original = globalThis.encodeURIComponent;
  globalThis.encodeURIComponent = () => original("export default 'other';");
  let found;
  try {
    found = (await import("data:text/javascript," + encodeURIComponent("export default 'written';"))).default;
  } catch (error) {
    found = "refused";
  }
  globalThis.encodeURIComponent = original;
  console.log(found === "written" ? "the module of the build" : "not the module of the build");
});

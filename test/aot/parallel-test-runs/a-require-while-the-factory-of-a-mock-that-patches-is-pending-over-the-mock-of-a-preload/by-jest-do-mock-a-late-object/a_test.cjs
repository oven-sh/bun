const { test, vi, mock, jest } = require("bun:test");
const show = value => (value === null || typeof value !== "object" ? String(value) : Object.keys(value).join() + " a " + String(value.a));
test("t", async () => {
  jest.doMock("./part.cjs", async () => {
    console.log("SAID the later factory is called");
    await 0;
    return { a: "later" };
  });
  console.log("SAID the call returns");
  
  try { console.log("SAID required", show(require("./part.cjs"))); } catch (error) { console.log("SAID require throws", error.name, error.message); }
  try { console.log("SAID again", show(require("./part.cjs"))); } catch (error) { console.log("SAID again throws", error.name); }
  await 0; await 0; await 0; await 0;
  try { console.log("SAID later", show(require("./part.cjs"))); } catch (error) { console.log("SAID later throws", error.name); }
  console.log("SAID the preload holds", heldByThePreload.a);
});

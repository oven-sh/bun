const { jest, mock, test, vi } = require("bun:test");
const said = [];
const tell = it => it === null || typeof it !== "object" ? String(it) : Object.keys(it).sort().map(name => name + "=" + String(it[name])).join("+");
test("one", async () => {
  
  let open; const gate = new Promise(done => { open = done; });
  console.log("SAID in front of the call");
  jest.doMock("./lib.mjs", async real => { said.push("factory"); await real(); return { a: "mocked" }; });
  said.push("behind the call");
  let late; try { late = "came " + tell(await import("./lib.mjs")); } catch (error) { late = "threw " + error.name + " " + error.message; }
  said.push("late " + late);
  for (const line of said) console.log("SAID", line);
  console.log("SAID runs", (globalThis.runs ?? []).length);
});

const { jest, mock, test, vi } = require("bun:test");
const tell = came => came === null || typeof came !== "object" && typeof came !== "function" ? String(came) : Object.keys(came).sort().map(name => { try { return name + "=" + (typeof came[name] === "function" ? "function" : String(came[name])); } catch (error) { return name + " threw " + error.name; } }).join();
const said = [];
const ask = async (tag, deed) => { try { said.push(tag + " came " + tell(await deed())); } catch (error) { said.push(tag + " threw " + error.name + " " + error.message); } };
test("one", async () => {
  const within = deed => Promise.race([deed(), new Promise(done => setTimeout(done, 300, "no answer"))]);
  let open; const gate = new Promise(done => { open = done; });
  jest.doMock("./lib.mjs", async () => { await gate; return { a: "mocked" }; });
  for (const ticks of [0, 1, 2, 3, 5, 8, 13]) { for (let t = 0; t < ticks; t++) await null; await ask("importActual " + ticks, () => within(() => vi.importActual("./lib.mjs"))); await ask("requireActual " + ticks, () => jest.requireActual("./lib.mjs")); }
  open();
  await new Promise(done => setTimeout(done, 40));
  await ask("import", () => import("./lib.mjs"));
  for (const line of said) console.log("SAID", line);
  console.log("SAID runs", (globalThis.runs ?? []).length);
});

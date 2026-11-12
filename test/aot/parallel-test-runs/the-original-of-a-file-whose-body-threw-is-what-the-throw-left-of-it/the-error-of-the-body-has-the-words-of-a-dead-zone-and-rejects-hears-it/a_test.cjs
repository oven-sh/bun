const { expect, jest, mock, test, vi } = require("bun:test");
const said = [];
const tell = it => it === null || typeof it !== "object" ? String(it) : Object.keys(it).sort().map(name => name + "=" + String(it[name])).join("+");
test("one", async () => {
  
  const watch = setTimeout(() => { console.log("SAID still waiting"); process.exit(4); }, 3000); watch.unref();
  const form = async (tag, deed) => { let got; try { got = deed(); } catch (error) { said.push(tag + " threw at the call " + error.name); return; } const kind = got instanceof Promise ? " a promise " : " a value "; let came; try { came = await got; } catch (error) { said.push(tag + kind + "rejected " + error.name); return; } try { said.push(tag + kind + "came " + tell(came)); } catch (error) { said.push(tag + kind + "came, and its listing threw " + error.name); } };
  try { await import("./lib.mjs"); } catch {}
  try {
    vi.doMock("./lib.mjs", () => ({ a: "mocked" }));
  } catch (error) { said.push("the call threw " + error.name + " " + error.message); }
  try { await expect(vi.importActual("./lib.mjs")).rejects.toThrow(ReferenceError); said.push("rejects heard it"); } catch (error) { said.push("rejects did not hear it: " + error.name); }


  for (const line of said) console.log("SAID", line);
});

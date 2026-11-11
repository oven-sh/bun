const { jest, mock, test, vi } = require("bun:test");
const said = [];
const tell = it => it === null || typeof it !== "object" ? String(it) : Object.keys(it).sort().map(name => name + "=" + String(it[name])).join("+");
test("one", async () => {
  
  const watch = setTimeout(() => { console.log("SAID still waiting"); process.exit(4); }, 3000); watch.unref();
  const nameOf = error => error === null || (typeof error !== "object" && typeof error !== "function") ? typeof error + ":" + String(error) : error.name;
  const form = async (tag, deed) => { let got; try { got = deed(); } catch (error) { said.push(tag + " threw at the call " + nameOf(error)); return; } const kind = got instanceof Promise ? " a promise " : " a value "; let came; try { came = await got; } catch (error) { said.push(tag + kind + "rejected " + nameOf(error)); return; } try { said.push(tag + kind + "came " + tell(came)); } catch (error) { said.push(tag + kind + "came, and its listing threw " + nameOf(error)); } };
  vi.doMock("./below.mjs", () => ({ c: "mocked" }));
  try { await import("./lib.mjs"); } catch {}
  vi.doUnmock("./below.mjs");
  try {
    vi.doMock("./lib.mjs", () => ({ a: "mocked" }));
  } catch (error) { said.push("the call threw " + error.name + " " + error.message); }
  await form("importActual", () => vi.importActual("./lib.mjs"));


  for (const line of said) console.log("SAID", line);
});

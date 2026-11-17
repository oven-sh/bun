const { jest, mock, test, vi } = require("bun:test");
const said = [];
const word = it => typeof it === "function" ? "function" : String(it);
const reads = (tag, it, names) => { for (const name of names) { try { said.push(tag + " " + name + ": " + (name in it ? word(it[name]) : "absent")); } catch (error) { said.push(tag + " " + name + ": " + error.name + ": " + error.message); } } };
const ask = (tag, deed, names) => { let got; try { got = deed(); } catch (error) { said.push(tag + " threw at the call " + error.name + ": " + error.message); return; } said.push(tag + " returned " + (got instanceof Promise ? "a promise" : typeof got)); return Promise.resolve(got).then(came => reads(tag, came, names), error => { said.push(tag + " rejected " + error.name + ": " + error.message); }); };
const tell = it => it === null || typeof it !== "object" ? String(it) : Object.keys(it).sort().map(name => name + "=" + String(it[name])).join("+");
test("one", async () => {
  
  let open; const gate = new Promise(done => { open = done; });
  let kept;
  try {
    jest.doMock("./lib.mjs", real => { said.push("factory"); kept = real; return { a: "mocked" }; });
  } catch (error) { said.push("the call threw " + error.name + " " + error.message); }
  said.push("behind the call");
  await ask("kept", () => kept(), ["a", "b"]);
  await ask("importActual", () => vi.importActual("./lib.mjs"), ["a", "b"]);
  await ask("requireActual", () => jest.requireActual("./lib.mjs"), ["a", "b"]);
  let late; try { late = "came " + tell(await import("./lib.mjs")); } catch (error) { late = "threw " + error.name + " " + error.message; }
  said.push("late " + late);
  for (const line of said) console.log("SAID", line);
  console.log("SAID runs", (globalThis.runs ?? []).length);
  console.log("SAID bodies", (globalThis.runs ?? []).join("+"));
});

import { jest, mock, test, vi } from "bun:test";
const word = it => String(typeof it === "function" ? it() : it);
const tried = async (label, load) => {
  let said;
  try {
    said = await load();
  } catch (error) {
    said = "threw " + error.name + " " + String(error.message).replace(/\/\S*\//g, "").slice(0, 60);
  }
  console.log("SAID " + label + " " + said + " calls " + (globalThis.calls ?? 0) + " settings " + (globalThis.settingsRan ?? 0) + " store " + (globalThis.storeRan ?? 0));
};
test("the kiln is cold", async () => {
  await tried("first", async () => word((await import("./app.mjs")).start));
});
test("behind the failure", async () => {
  vi.doMock("./store.mjs", async original => { globalThis.calls = (globalThis.calls ?? 0) + 1; return { ...(await original()), ...{ list: () => "mocked list" } }; });
  console.log("SAID laid" + " calls " + (globalThis.calls ?? 0) + " settings " + (globalThis.settingsRan ?? 0) + " store " + (globalThis.storeRan ?? 0));
  await tried("asked", async () => { const it = await import("./store.mjs"); return word(it.list); });
  await tried("again", async () => { const it = await import("./store.mjs"); return word(it.list); });
  vi.doUnmock("./store.mjs");
  console.log("SAID ended" + " calls " + (globalThis.calls ?? 0) + " settings " + (globalThis.settingsRan ?? 0) + " store " + (globalThis.storeRan ?? 0));
  await tried("behind the end", async () => { const it = await import("./store.mjs"); return word(it.list); });
});

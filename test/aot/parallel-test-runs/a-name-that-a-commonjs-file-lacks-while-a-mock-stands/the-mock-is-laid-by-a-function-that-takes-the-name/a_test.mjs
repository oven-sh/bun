import { test, vi } from "bun:test";
const lay = (name, ...rest) => vi.doMock(name, ...rest);
test("the load", async () => {
  lay("./other.cjs", () => ({ height: "mock" }));
  console.log("SAID", await import("./entry.mjs").then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, "")));
});

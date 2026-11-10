import { jest, test, vi } from "bun:test";
const outcome = load => load.then(() => "loaded", error => error.message);
test("two mocks behind a graph that failed", async () => {
  const trail = globalThis.trail = [];
  const first = await outcome(import("./bakery.mjs"));
  vi.doMock("./shelf.mjs", () => { trail.push("factory of shelf"); return { shelf: () => "mocked shelf" }; });
  trail.push("behind the first");
  jest.doMock("./label.mjs", () => { trail.push("factory of label"); return { label: "mocked label" }; });
  trail.push("behind the second");
  const shelf = (await import("./shelf.mjs")).shelf();
  const label = (await vi.importActual("./label.mjs")).label;
  console.log("SAID", first, "|", shelf, "|", label, "|", trail.join(" > "));
});

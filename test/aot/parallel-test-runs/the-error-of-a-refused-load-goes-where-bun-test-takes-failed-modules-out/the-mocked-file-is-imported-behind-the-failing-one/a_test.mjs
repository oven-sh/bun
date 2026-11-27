import { test, mock, vi } from "bun:test";
test("one door", async () => {
  const first = await import("./root.mjs").catch(error => error);
  console.log("SAID refused", first.name);
  vi.doMock("./far.mjs", () => ({ far: "mock" }));
  console.log("SAID laid");
  const second = await import("./root.mjs").catch(error => error);
  console.log("SAID again", second.name, first === second ? "kept" : "anew");
  const under = await import("./far.mjs").catch(error => error);
  console.log("SAID under", Object.keys(under).sort().join("+"), under.far);
  vi.doUnmock("./far.mjs");
  const third = await import("./root.mjs").catch(error => error);
  console.log("SAID ended", third.name, second === third ? "kept" : "anew");
  const behind = await import("./far.mjs").catch(error => error);
  console.log("SAID behind", Object.keys(behind).sort().join("+"), behind.far);
});

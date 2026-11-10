import { test, vi } from "bun:test";
test("a chain of such mocks", async () => {
  vi.doMock("./s1.mjs", async original => { await original(); return { f1: -1 }; });
  vi.doMock("./s2.mjs", async original => { await original(); return { f2: -2 }; });
  vi.doMock("./s3.mjs", async original => { await original(); return { f3: -3 }; });
  vi.doMock("./shapes.mjs", async original => { await original(); return { square: 3 }; });
  console.log("SAID", (await import("./user.mjs")).look());
  const all = await import("./outer.mjs"), key = process.argv.length > 90 ? "none" : "round";
  let sum = 0;
  for (let i = 0; i < 100; i++) sum += all[key];
  console.log("SAID sum", sum);
});

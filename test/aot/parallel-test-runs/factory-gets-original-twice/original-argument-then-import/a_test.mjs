import { test, vi } from "bun:test";
test("one factory, two ways", async () => {
  vi.doMock("./clay.mjs", async original => {
    const one = await original();
    const two = await import("./clay.mjs");
    console.log("SAID the factory has " + one.name + ", " + two.name + ", one object made: " + (one.made === two.made));
    return { ...one, name: "mock clay" };
  });
  console.log("SAID the test has " + (await import("./clay.mjs")).name);
}, 3000);

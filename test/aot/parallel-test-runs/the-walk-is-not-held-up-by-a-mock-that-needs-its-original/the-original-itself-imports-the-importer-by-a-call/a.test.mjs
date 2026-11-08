import { test, vi } from "bun:test";
vi.mock("./base.mjs", async original => {
  const real = await original();
  return {
    ...real,
    Base: class {
      name() {
        return "mock";
      }
    },
  };
});
test("the call in the body of the original joins the load under way", async () => {
  const said = [];
  said.push(
    await import("./rung.mjs").then(
      found => new found.Derived().name(),
      error => error.name,
    ),
  );
  said.push(
    await vi.importActual("./base.mjs").then(
      found => found.later,
      error => error.name,
    ),
  );
  console.log("SAID", said.join(" | "));
});

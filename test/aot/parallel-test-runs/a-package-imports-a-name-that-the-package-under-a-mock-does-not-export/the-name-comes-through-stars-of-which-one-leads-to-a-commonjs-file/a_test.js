import { test, vi } from "bun:test";
test("a file of the package asks for a name that the original does export", async () => {
  vi.doMock("rack/upper.mjs", async original => ({ ...(await original()), upper: "mocked" }));
  vi.doMock("rack/lower.mjs", async original => ({ ...(await original()), lower: "mocked" }));
  await import("rack/front.mjs");
  await import("rack/back.mjs");
  console.log(await import("rack/user.mjs").then(own => own.got, error => error.name));
});

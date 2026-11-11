import { vi } from "bun:test";
vi.mock("./part.mjs", async original => {
  console.log("SAID the factory of the preload is called");
  return { ...(await original()), more: "of the mock of the preload" };
});

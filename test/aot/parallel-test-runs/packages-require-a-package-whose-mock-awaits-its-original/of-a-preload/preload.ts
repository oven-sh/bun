import { vi } from "bun:test";
vi.mock("lib", async original => {
  console.log("SAID the factory begins");
  return { ...(await original()), version: "mocked" };
});

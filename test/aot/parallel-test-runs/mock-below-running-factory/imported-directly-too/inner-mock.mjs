import { vi } from "bun:test";
vi.mock("./inner.mjs", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, inner: () => "mocked " + actual.inner() };
});

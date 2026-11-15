import { vi } from "vitest";
vi.mock("./cat.js", async importOriginal => { const actual = await importOriginal(); return { ...actual, cat: () => "mocked " + actual.cat() }; });
export const helper = 1;

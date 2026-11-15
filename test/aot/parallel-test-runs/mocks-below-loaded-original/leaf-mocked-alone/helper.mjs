import { vi } from "vitest";
vi.mock("./leaf.mjs", () => ({ leaf: () => "mocked leaf" }));

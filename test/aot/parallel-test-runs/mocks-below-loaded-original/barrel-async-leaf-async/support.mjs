import "./helper.mjs";
import { vi } from "vitest";
vi.mock("./leaf.mjs", async () => ({ leaf: () => "mocked leaf" }));
export const support = 1;

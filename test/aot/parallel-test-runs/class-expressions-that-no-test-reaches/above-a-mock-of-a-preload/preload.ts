import { vi } from "bun:test";
vi.mock("./rates.ts", () => ({ rate: 2 }));

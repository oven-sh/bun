import { vi } from "bun:test";
vi.mock("./shapes.mjs", () => ({ round: 10 }));

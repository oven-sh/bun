import { vi } from "bun:test";
vi.mock("./data.json", () => ({ default: { who: "standing", other: "standing other" } }));

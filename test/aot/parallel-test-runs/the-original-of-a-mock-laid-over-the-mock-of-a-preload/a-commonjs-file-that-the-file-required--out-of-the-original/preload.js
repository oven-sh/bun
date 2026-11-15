import { vi } from "bun:test";
vi.mock("./dep.cjs", () => ({ who: "standing", other: "standing other" }));

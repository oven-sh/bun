import { vi } from "bun:test";
vi.mock("./dep.js", () => ({ who: "standing", other: "standing other" }));
await import("./dep.js");

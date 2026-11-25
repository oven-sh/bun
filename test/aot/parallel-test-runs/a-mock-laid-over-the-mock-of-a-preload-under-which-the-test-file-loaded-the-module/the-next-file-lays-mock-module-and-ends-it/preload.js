import { vi } from "bun:test";
vi.mock("./dep.js", () => ({ who: "standing" }));

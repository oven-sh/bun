import { vi } from "bun:test";
vi.mock("widget", () => ({ who: "standing" }));
globalThis.heldEarly = () => "nobody";

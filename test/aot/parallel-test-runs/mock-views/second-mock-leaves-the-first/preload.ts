import { vi } from "bun:test";
import { viaEarly } from "./early";

vi.mock("./lib", () => ({ who: "preload" }));
(globalThis as any).heldByPreload = viaEarly;

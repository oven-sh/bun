import { it, vi } from "vitest";
import { call } from "./p.ts";
vi.mock("./g.ts", async () => ({ intents: (await import("./types.ts")).bits, Plugin: class {} }));
vi.mock("./w.ts", () => ({ socket: () => "mocked", Socket: class {} }));
it("second", () => console.log("second", call()));

import { it, vi } from "vitest";
import { call } from "./p.ts";
vi.mock("./g.ts", async () => ({ intents: (await import("./types.ts")).bits, Plugin: class {} }));
vi.mock("./w.ts", async importOriginal => ({ ...(await importOriginal<any>()), Socket: class {} }));
it("second", () => console.log("second", call()));

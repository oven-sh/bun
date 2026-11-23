import { it, vi } from "vitest";
import { codes } from "./g.ts";
vi.mock("./r.ts", async importOriginal => ({ ...(await importOriginal<any>()), added: 1 }));
it("first", () => console.log("first", codes.closed));

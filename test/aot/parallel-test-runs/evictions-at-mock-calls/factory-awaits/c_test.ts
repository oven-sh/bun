import { it, vi } from "vitest";
vi.mock("./account", async () => { await 0; return { account: () => 5 }; });
import { parse } from "./credentials";
it("c", () => console.log("c", parse()));

import { it, vi } from "vitest";
vi.mock("./account", async original => ({ ...(await original<any>()) }));
import { account } from "./account";
it("c", () => console.log("c", account()));

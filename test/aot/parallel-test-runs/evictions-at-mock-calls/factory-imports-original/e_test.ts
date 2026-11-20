import { it, vi } from "vitest";
vi.mock("./account", async original => ({ ...(await original<any>()) }));
import { parse } from "./credentials";
it("e", () => console.log("e", parse()));

import { it, vi } from "vitest";
vi.mock("./user", async original => { const real = await original<any>(); return { user: () => "kept " + real.user() }; });
vi.mock("./leaf", () => ({ leaf: "mocked leaf" }));
import { user } from "./user";
it("b", () => console.log("b", user()));

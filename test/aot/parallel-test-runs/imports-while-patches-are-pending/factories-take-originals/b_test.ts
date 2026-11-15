import { it, vi } from "vitest";
vi.mock("./user", async original => { const real = await original<any>(); return { user: () => "kept " + real.user() }; });
vi.mock("./leaf", async original => { const real = await original<any>(); return { leaf: "kept " + real.leaf }; });
import { user } from "./user";
it("b", () => console.log("b", user()));

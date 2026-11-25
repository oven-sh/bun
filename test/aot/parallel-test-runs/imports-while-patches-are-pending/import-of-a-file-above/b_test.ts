import { it, vi } from "vitest";
vi.mock("./user", async original => { const real = await original<any>(); return { user: () => "kept " + real.user() }; });
vi.mock("./leaf", () => ({ leaf: "mocked leaf" }));
import { other } from "./other";
it("b", () => console.log("b", other()));

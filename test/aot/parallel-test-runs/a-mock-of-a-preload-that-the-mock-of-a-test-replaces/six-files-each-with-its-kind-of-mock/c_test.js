import { test, vi } from "bun:test";
import * as dep from "./dep.js";
import { viaUser } from "./user.js";
import { viaHelper } from "./helper.js";
vi.mock("./dep.js", async importOriginal => ({ ...(await importOriginal()), who: "file" }));
const read = (held, name) => { try { return String(held[name]); } catch { return "threw"; } };
test("t", () => console.log("SAID", "a-factory-out-of-the-original", read(dep, "who"), read(dep, "other"), Object.keys(dep).sort().join("+"), viaUser(), viaHelper()));

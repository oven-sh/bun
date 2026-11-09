import { test, vi } from "bun:test";
import * as dep from "./dep.js";
import { viaUser } from "./user.js";
import { viaHelper } from "./helper.js";
vi.mock("./dep.js", () => ({ who: "file" }));
const read = (held, name) => { try { return String(held[name]); } catch { return "threw"; } };
test("t", () => console.log("SAID", "a-factory", read(dep, "who"), read(dep, "other"), Object.keys(dep).sort().join("+"), viaUser(), viaHelper()));

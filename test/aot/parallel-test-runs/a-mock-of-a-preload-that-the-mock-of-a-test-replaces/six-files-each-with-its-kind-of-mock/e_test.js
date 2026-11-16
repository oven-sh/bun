import { test, vi } from "bun:test";
import * as dep from "./dep.js";
import { viaUser } from "./user.js";
import { viaHelper } from "./helper.js";
vi.unmock("./dep.js");
const read = (held, name) => { try { return String(held[name]); } catch { return "threw"; } };
test("t", () => console.log("SAID", "unmock", read(dep, "who"), read(dep, "other"), Object.keys(dep).sort().join("+"), viaUser(), viaHelper()));

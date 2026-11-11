import { test, mock } from "bun:test";
const tell = space => Object.keys(space).map(key => { try { return key + "=" + space[key]; } catch (error) { return key + "!" + error.name; } }).join();
const load = async path => { try { return tell(await import(path)); } catch (error) { return error.name + ": " + String(error.message).slice(0, 80); } };
test.skip("never", () => { mock.module("./other.mjs", () => ({ round: 3, far: 4 })); });
test("t", async () => { console.log("SAID outer", await load("./outer.mjs")); });

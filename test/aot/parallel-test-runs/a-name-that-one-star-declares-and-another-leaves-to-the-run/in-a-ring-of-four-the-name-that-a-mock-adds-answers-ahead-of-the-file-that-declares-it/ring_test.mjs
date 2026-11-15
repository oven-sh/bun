import { test, mock } from "bun:test";
const tell = space => Object.keys(space).map(key => { try { return key + "=" + space[key]; } catch (error) { return key + "!" + error.name; } }).join();
const load = async path => { try { return tell(await import(path)); } catch (error) { return error.name + ": " + error.message.replace(/ in module .*| in \S+$/, ""); } };
test("ring", async () => {
  mock.module("./leaf2.mjs", () => ({ p2: -1, p3: -33 }));
  console.log("SAID first", await load("./first.mjs"));
  console.log("SAID second", await load("./second.mjs"));
  console.log("SAID third", await load("./third.mjs"));
  console.log("SAID between1", await load("./between1.mjs"));
});

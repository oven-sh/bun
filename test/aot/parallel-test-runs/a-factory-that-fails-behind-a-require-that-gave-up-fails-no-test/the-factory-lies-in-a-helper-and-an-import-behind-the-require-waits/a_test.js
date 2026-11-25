import { test } from "bun:test";
import { lay } from "./helper.js";
const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(done => setImmediate(done)); };
const asked = () => { try { return String(require("./kiln.js").heat); } catch (error) { return error.constructor.name; } };
test("a", async () => {
  lay();
  console.log(asked());
  console.log(await Promise.race([import("./kiln.js").then(it => String(it.heat), error => error.constructor.name), turns(30).then(() => "waits")]));
  console.log(globalThis.ran ?? "has not run");
});

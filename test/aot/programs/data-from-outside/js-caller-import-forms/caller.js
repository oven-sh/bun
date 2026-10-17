import * as space from "./typedA.ts";
import byDefault from "./typedB.ts";
import { Taker } from "./typedC.ts";
const row = async (name, run) => { try { console.log(name + ": " + await run()); } catch (error) { console.log(name + ": THROWS " + String(error).split(" (bun")[0]); } };
const plain = () => ({ id: 1, name: "given" });
export async function run(handed) {
  await row("through a namespace", () => space.one(plain()));
  await row("a default export", () => byDefault(plain()));
  await row("a constructor", () => new Taker(plain()).show());
  await row("a dynamic import", async () => (await import("./typedD.ts")).one(plain()));
  await row("a function that typed code hands over", () => handed(plain()));
}

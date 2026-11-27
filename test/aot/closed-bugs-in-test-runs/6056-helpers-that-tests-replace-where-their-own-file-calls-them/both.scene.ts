import { mock, spyOn, test } from "bun:test";
import * as own from "./own4.mjs";
test("spied through a name made at the run", () => {
  const key = ["__public", "Field"].join("");
  console.log("SAID made before", Object.keys(own.make()).join());
  const spy = spyOn(own as any, key).mockImplementation(((o: any, k: string, v: any) => { o["made_" + k] = v; }) as any);
  console.log("SAID made behind", Object.keys(own.make()).join(), spy.mock.calls.length);
});

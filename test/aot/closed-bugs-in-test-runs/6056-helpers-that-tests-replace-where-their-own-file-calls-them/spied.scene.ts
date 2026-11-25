import { spyOn, test } from "bun:test";
import * as own from "./own3.mjs";
test("spied on, the file itself calls the helper", () => {
  console.log("SAID spied own before", Object.keys(own.make()).join(), own.named());
  const spies = [spyOn(own, "__publicField").mockImplementation(((o: any, k: string, v: any) => { o["spied_" + k] = v; }) as any), spyOn(own, "__name").mockImplementation((() => "spied") as any)];
  let keys = "";
  for (let i = 0; i < 50; i++) keys = Object.keys(own.make()).join();
  console.log("SAID spied own behind", keys, own.named(), spies[0].mock.calls.length, spies[1].mock.calls.length);
  for (const spy of spies) spy.mockRestore();
  console.log("SAID spied own restored", Object.keys(own.make()).join(), own.named());
});

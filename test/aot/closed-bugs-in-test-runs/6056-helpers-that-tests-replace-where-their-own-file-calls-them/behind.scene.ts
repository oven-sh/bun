import { mock, test } from "bun:test";
import { make, named } from "./own2.mjs";
test("mocked behind, the file itself calls the helper", () => {
  console.log("SAID own before", Object.keys(make()).join(), named());
  mock.module("./own2.mjs", () => ({
    __publicField: (object: any, key: string, value: any) => { object["late_" + key] = value; return value; },
    __name: (named: any) => "mocked",
  }));
  let keys = "";
  for (let i = 0; i < 50; i++) keys = Object.keys(make()).join();
  console.log("SAID own behind", keys, named());
});

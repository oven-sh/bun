import { test, vi } from "bun:test";
import * as ns from "./lib";

const show = (read: () => unknown) => {
  try {
    return String(read());
  } catch {
    return "threw";
  }
};
const face = (object: any) => [show(() => object.flag), show(() => object["fl" + "ag"]), show(() => Object.keys(object).join("+")), "added" in object].join(" ");

// lib has run, so vi.doMock() leaves it alone: a load by name gets an object of the mock, and that object is the mock's for good.
test("the object that was made under a mock answers by that mock when the mock has ended", async () => {
  vi.doMock("./lib", () => ({ flag: "mock", added: 1 }));
  const one = await import("./lib");
  vi.doMock("./lib", () => ({ flag: "second", more: 2 }));
  const two = await import("./lib");
  console.log("three objects:", one === two, one === ns, two === ns);
  vi.doUnmock("./lib");
  console.log("the module's own is back:", (await import("./lib")) === ns);
  console.log("one:", face(one));
  console.log("two:", face(two));
  console.log("held:", face(ns));
});

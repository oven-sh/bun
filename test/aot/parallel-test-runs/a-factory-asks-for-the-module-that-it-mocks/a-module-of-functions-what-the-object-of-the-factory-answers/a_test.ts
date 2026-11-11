// What the object that the factory was handed answers behind the mock: by a written name, by Reflect.get(), by its descriptor, by a name that is put together.
import { test, mock } from "bun:test";
let kept, atFactory;
const mockRate = () => "mock rate";
mock.module("./tax", async () => { kept = await import("./tax"); atFactory = kept.rate; console.log("factory", kept.rate === mockRate, kept.rate.name, Object.keys(kept).join()); return { rate: mockRate }; });
test("a", async () => {
  const tax = await import("./tax");
  console.log("a", kept === tax, kept.rate === mockRate, kept.rate === atFactory, tax.rate === mockRate, Object.keys(kept).join(), Object.keys(tax).join(), typeof kept.fee, typeof tax.fee);
  console.log("a", Reflect.get(kept, "rate") === mockRate, Object.getOwnPropertyDescriptor(kept, "rate").value === mockRate, (0, eval)("1") && kept["ra" + "te"] === mockRate);
});

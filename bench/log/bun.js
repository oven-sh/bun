import { bench, run } from "mitata";

bench("console.log('hello')", () => console.log("hello"));
bench("console.log({ hello: 'object' })", () =>
  console.log({ hello: "object" }),
);
await run();

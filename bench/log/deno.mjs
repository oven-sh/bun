import { bench, run } from "../runner.mjs";

bench("console.log", () => console.log("hello"));
bench("console.log({ hello: 'object' })", () => console.log({ hello: "object" }));
await run();

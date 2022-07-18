import { bench, run } from "../node_modules/mitata/src/cli.mjs";

bench("console.log", () => console.log("hello"));
bench("console.log({ hello: 'object' })", () => console.log({ hello: "object" }));
await run();

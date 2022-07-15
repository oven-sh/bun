import { bench, run } from "../../node_modules/mitata/src/cli.mjs";

bench("console.log", () => console.log("hello"));
await run();

import { bench, run } from "mitata";

bench("console.log", () => console.log("hello"));
await run();

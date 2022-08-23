import { bench, run } from "mitata";
import { cpus, networkInterfaces } from "node:os";

bench("cpus()", () => cpus());
bench("networkInterfaces()", () => networkInterfaces());
await run();

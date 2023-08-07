import { readFileSync } from "fs";
import { init, getTests } from "../index.mjs";

const buf = (process.argv.length > 2 ? readFileSync(process.argv.at(-1)) : "") || readFileSync(import.meta.url);
await init(new URL("../bun.wasm", import.meta.url));

console.log(getTests(buf));

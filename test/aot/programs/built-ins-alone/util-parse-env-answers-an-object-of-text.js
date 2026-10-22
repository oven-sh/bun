import { parseEnv } from "node:util";
const parsed = parseEnv("FIRST=1\nSECOND=two");
console.log(typeof parsed.FIRST, parsed.FIRST.length, parsed.SECOND, parsed.MISSING === undefined, Object.keys(parsed).join());

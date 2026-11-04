import { isDeepStrictEqual } from "node:util";
const name = process.argv[2] ?? "constructor";
function build() { const rec = { id: 1 }; rec[name] = { n: 1 }; return rec; }
console.log(isDeepStrictEqual(build(), build()));

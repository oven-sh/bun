import { writeSync } from "node:fs";
let n = 0;
let err = "";
try {
  for (let i = 0; i < 200000; i++) { writeSync(1, "line " + i + " " + "x".repeat(200) + "\n"); n++; }
} catch (e: any) { err = `${e.code}: ${e.message}`; }
await Bun.write(process.argv[2], `wrote ${n} lines; error: ${err}\n`);

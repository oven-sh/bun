// Compares the port of the skip rule with the Go ground truth over the full product of field values (research probe).
import { readFileSync } from "node:fs";
import { skipUnsupportedCompilerOptions } from "./harnessutil";
let n = 0, bad = 0;
for (const line of readFileSync(process.argv[2], "utf8").split("\n")) {
  if (line === "") continue;
  const f = line.split("\t");
  n++;
  const got = skipUnsupportedCompilerOptions({
    module: Number(f[0]), moduleResolution: Number(f[1]), esModuleInterop: Number(f[2]), allowSyntheticDefaultImports: Number(f[3]),
    target: Number(f[4]), alwaysStrict: Number(f[5]), baseUrl: f[6], outFile: f[7],
  });
  const wantSkip = f[8] === "true";
  const want = f[9] ?? "";
  if ((got !== undefined) !== wantSkip || (got ?? "") !== want) { bad++; if (bad < 10) console.log(JSON.stringify({ line, got, want })); }
}
console.log("vectors", n, "mismatches", bad);

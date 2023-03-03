import { readFileSync } from "fs";
const fixture = ["action", "default", "loader"];

const transpiler = new Bun.Transpiler({
  loader: "ts",
});

console.time("Get exports");
const ITERATIONS = parseInt(process.env.ITERATIONS || "1") || 1;
for (let i = 0; i < ITERATIONS; i++) {
  const imports = transpiler.scanImports(readFileSync("remix-route.ts", "utf8"));
}
console.timeEnd("Get exports");

import { readFileSync } from "fs";
const fixture = ["action", "default", "loader"];
const ITERATIONS = parseInt(process.env.ITERATIONS || "1") || 1;

const transpiler = new Bun.Transpiler({
  loader: "ts",
});

console.time("Get exports");
const file = readFileSync("remix-route.ts", "utf8");
for (let i = 0; i < ITERATIONS; i++) {
  const { imports, exports } = transpiler.scan(file);

  for (let j = 0; j < fixture.length; j++) {
    if (fixture[j] !== exports[j]) {
      throw new Error("Mismatch");
    }
  }
}

console.timeEnd("Get exports");

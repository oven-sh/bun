import { build } from "bun";

const result = await build({
  entrypoints: ["./test.js"],
  outdir: "./out",
  gz: "gzip",
});

console.log("Build result:", result);
console.log("Outputs:", result.outputs);

// Check if files were created
import fs from "fs";
console.log("\nFiles in out directory:");
fs.readdirSync("./out").forEach(file => {
  const stat = fs.statSync(`./out/${file}`);
  console.log(`  ${file} - ${stat.size} bytes`);
});

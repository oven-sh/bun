// I would have made this a bash script but there isn't an easy way to track
// time in bash sub-second cross platform.
import fs from "fs";
const start = Date.now() + 5;
const result = Bun.spawnSync(process.argv.slice(2), {
  stdio: ["inherit", "inherit", "inherit"],
});
const end = Date.now();
const diff = (Math.max(Math.round(end - start), 0) / 1000).toFixed(3);
const success = result.exitCode === 0;
try {
  const line = `${new Date().toISOString()}, ${success ? "success" : "fail"}, ${diff}\n`;
  if (fs.existsSync(".scripts/make-dev-stats.csv")) {
    fs.appendFileSync(".scripts/make-dev-stats.csv", line);
  } else {
    fs.writeFileSync(".scripts/make-dev-stats.csv", line);
  }
} catch {
  // Ignore
}
process.exit(result.exitCode);

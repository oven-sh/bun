// Runs a ground-truth binary over the vectors; a vector that ends the process with a fatal error gets the line {"crash":true}.
// usage: bun drive.ts <gt binary> <vectors.json> <out.jsonl>
import { existsSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";

const [gt, vectorsPath, outPath] = process.argv.slice(2);
const total = (JSON.parse(readFileSync(vectorsPath, "utf8")) as unknown[]).length;
if (existsSync(outPath)) rmSync(outPath);
writeFileSync(outPath, "");
let crashes = 0;
for (;;) {
  const done = readFileSync(outPath, "utf8").split("\n").filter(l => l !== "").length;
  if (done >= total) break;
  const proc = Bun.spawnSync([gt, vectorsPath, outPath, String(done)], { stdout: "ignore", stderr: "pipe" });
  if (proc.exitCode === 0) continue;
  // The file may end in a half line when the process died while it wrote: keep whole lines only.
  const text = readFileSync(outPath, "utf8");
  const whole = text.slice(0, text.lastIndexOf("\n") + 1);
  const at = whole.split("\n").filter(l => l !== "").length;
  const err = proc.stderr.toString();
  const first = err.split("\n").find(l => /fatal error|goroutine stack exceeds|panic:/.test(l)) ?? err.slice(0, 200);
  writeFileSync(outPath, whole);
  appendFileSync(outPath, JSON.stringify({ crash: true, at, reason: first }) + "\n");
  crashes++;
}
console.log(`${total} vectors, ${crashes} end the process`);

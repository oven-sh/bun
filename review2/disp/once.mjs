import { spawn } from "node:child_process";
import { once } from "node:events";
const slot = Number(process.argv[2]); // 1 or 3
const N = 3000000;
const cmd = slot === 1 ? `head -c ${N} /dev/zero` : `head -c ${N} /dev/zero >&3`;
const child = spawn("sh", ["-c", cmd], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
const s = slot === 1 ? child.stdout : child.stdio[3];
let got = 0, ended = false;
s.on("end", () => { ended = true; });
const t = setTimeout(() => { console.log(`slot ${slot}: TIMEOUT got ${got} lost ${N - got}`); process.exit(2); }, 4000);
while (!ended) {
  const r = await Promise.race([once(s, "data"), once(s, "end").then(() => null)]);
  if (!r) break;
  got += r[0].length;
}
clearTimeout(t);
console.log(`slot ${slot}: got ${got} lost ${N - got}`);
process.exit(0);

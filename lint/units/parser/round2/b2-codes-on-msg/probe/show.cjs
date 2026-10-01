const fs = require("fs");
const inputs = JSON.parse(fs.readFileSync(process.argv[3] || "inputs.json", "utf8"));
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
for (const line of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const [k, s] = inputs[+f[0]];
  if (f[1] === "ok" || f[1] === "panic") { console.log(JSON.stringify(s), `[${k}]`, f[1]); continue; }
  console.log(JSON.stringify(s), `[${k}]`, `${f[1]} bun @${f[2]}+${f[3]} ${JSON.stringify(unhex(f[8]))} msgs=${f[7]} | entry code=${f[4]} ${f[5]}..${f[6]} ${JSON.stringify(unhex(f[9]))}`);
}

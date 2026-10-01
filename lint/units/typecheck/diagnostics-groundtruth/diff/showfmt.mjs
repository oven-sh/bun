import fs from "node:fs";
const vec = fs.readFileSync("vectors.txt","utf8").split("\n").filter(l=>l.startsWith("FMT "));
const out = fs.readFileSync(process.argv[2],"utf8").split("\n").filter(l=>l.startsWith("FMT "));
const un = h => h === "-" ? Buffer.alloc(0) : Buffer.from(h, "hex");
const show = b => JSON.stringify(b.toString("latin1")).replace(/[\u0080-\u00ff]/g, c => "\\x" + c.charCodeAt(0).toString(16));
for (let i = 0; i < vec.length; i++) {
  const f = vec[i].split(" ");
  const args = f.slice(3).map(un).map(show).join(", ");
  console.log(show(un(f[1])).padEnd(34), "[" + args + "]", "=>", show(un(out[i].split(" ")[1])));
}

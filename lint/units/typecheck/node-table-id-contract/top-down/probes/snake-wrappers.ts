// For every colliding pair of data/snake-collisions.txt: does the body of the exported function call the unexported one?
import { readFileSync } from "node:fs";
const R = "/workspace/ref/typescript-go/internal";
let yes = 0, no = 0;
const all = new Set<string>();
for (const line of readFileSync("data/snake-collisions.txt", "utf8").split("\n")) {
  if (!line) continue;
  const [pkg, ns, sn, ...names] = line.split("\t");
  all.add(`${pkg}\t${ns}\t${sn}`);
  const parsed = names.map(n => { const [name, loc] = n.split("@"); const [file, ln] = loc.split(":"); return { name, file, ln: +ln }; });
  const exported = parsed.find(p => p.name[0] === p.name[0].toUpperCase())!;
  const unexported = parsed.find(p => p.name[0] !== p.name[0].toUpperCase())!;
  const lines = readFileSync(`${R}/${pkg}/${exported.file}`, "utf8").split("\n");
  let body = "";
  for (let i = exported.ln - 1; i < lines.length; i++) { body += lines[i] + "\n"; if (lines[i] === "}" || /\}$/.test(lines[i]) && i === exported.ln - 1) break; }
  const calls = new RegExp(`\\b${unexported.name}\\(`).test(body);
  if (calls) yes++; else { no++; console.log("NOT A WRAPPER:", pkg, ns, exported.name, `${exported.file}:${exported.ln}`, "lines", body.split("\n").length); }
}
console.log(`pairs where the exported function calls the unexported one: ${yes}; others: ${no}`);

import fs from "node:fs";
const go = fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go", "utf8");
const re = /^var (\w+) = &Message\{code: (-?\d+),/gm;
let m, out = "// generated for the ground-truth probe\npackage main\n\nimport \"github.com/microsoft/typescript-go/internal/diagnostics\"\n\nvar byCode = map[int32]*diagnostics.Message{\n";
let n = 0;
while ((m = re.exec(go))) { out += `\t${m[2]}: diagnostics.${m[1]},\n`; n++; }
out += "}\n";
fs.writeFileSync(process.argv[2] ?? "zz_bycode.go", out);
console.log(n);

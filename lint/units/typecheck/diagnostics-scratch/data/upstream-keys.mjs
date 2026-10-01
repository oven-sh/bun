import fs from "node:fs";
const go = fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go", "utf8");
const re = /^var \w+ = &Message\{code: -?\d+, category: Category\w+, key: ("(?:[^"\\]|\\.)*"),/gm;
let m, out = "";
while ((m = re.exec(go))) out += JSON.parse(m[1]) + "\n";
fs.writeFileSync("/tmp/diaggen/proto/expected_keys.txt", out);
console.log(out.split("\n").length - 1, "keys", out.length, "bytes");

// node gen-vectors.cjs && node gen-context.cjs: writes vectors.rs, the tables that main.rs checks, as Rust byte strings.
const fs = require("fs");
const lit = s => { let o = 'b"'; for (const b of Buffer.from(s, "utf8")) { if (b === 0x5c) o += "\\\\"; else if (b === 0x22) o += '\\"'; else if (b === 0x0a) o += "\\n"; else if (b === 0x0d) o += "\\r"; else if (b === 0x09) o += "\\t"; else if (b >= 0x20 && b < 0x7f) o += String.fromCharCode(b); else o += "\\x" + b.toString(16).padStart(2, "0"); } return o + '"'; };
const files = ["/workspace/notes/lint/units/parser/lexer-lint-hooks/top-down/pragma-inputs.json", "/workspace/notes/lint/units/parser/lexer-lint-hooks/bottom-up/pragmas-inputs.json", __dirname + "/../pragmas/extra-inputs.json"];
let out = "pub const PRAGMA_TEXTS: &[&[u8]] = &[\n";
for (const f of files) for (const [, s] of JSON.parse(fs.readFileSync(f, "utf8"))) out += `    ${lit(s)},\n`;
out += "];\n\n";
const inputs = JSON.parse(fs.readFileSync(__dirname + "/../directives/inputs.json", "utf8"));
const go = fs.readFileSync(__dirname + "/../directives/expected-go.txt", "utf8").split("\n");
out += "pub const DIRECTIVE_VECTORS: &[(&str, &[u8], &[(u32, u32)], &str)] = &[\n";
inputs.forEach(([name, s], i) => {
  const comments = /comments=\[(.*?)\]/.exec(go[i * 3 + 1])[1].split(" ").filter(Boolean).map(c => `(${c.replace("..", ", ")})`).join(", ");
  const directives = /directives=\[(.*)\]/.exec(go[i * 3 + 2])[1];
  out += `    (${JSON.stringify(name)}, ${lit(s)}, &[${comments}], ${JSON.stringify(directives)}),\n`;
});
out += "];\n";
fs.writeFileSync(__dirname + "/vectors.rs", out);
console.log("ok", inputs.length);

// usage: node gen-must-parse.cjs rows.be1ebe5295.txt > must-parse.rs.txt
// The sources that typescript-go parses and the parse pass of bun takes (class "ok" of join.cjs), as rows for a Rust test,
// without those where bun's tree is another one than the reference's (a postfix update or a JSX element, a line break, then "(", "[" or a template).
const fs = require("node:fs");
const loaders = { ts: "Loader::Ts", tsx: "Loader::Tsx", js: "Loader::Js", jsx: "Loader::Jsx" };
const seen = new Set();
for (const line of fs.readFileSync(process.argv[2], "utf8").split("\n")) {
  const m = /^ok +(ts|tsx|js|jsx) +(".*")  go: parses$/.exec(line);
  if (!m) continue;
  const code = JSON.parse(m[2]);
  if (/(\+\+|--|\/>)\n[(\[`]/.test(code)) continue;
  const key = m[1] + m[2];
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`    (b${m[2]}, ${loaders[m[1]]}),`);
}

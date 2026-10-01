// Prints ESLint's answer and where the n-th `case` keyword is (1-based line:col in UTF-16 units).
const { run } = require("./oracle.cjs");
const cases = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
function lineCol(code, index) {
  let line = 1, col = 1;
  for (let i = 0; i < index; i++) {
    const c = code[i];
    if (c === "\n") { line++; col = 1; }
    else if (c === "\r") { if (code[i + 1] === "\n") i++; line++; col = 1; }
    else col++;
  }
  return `${line}:${col}`;
}
for (const c of cases) {
  const code = c.code, nth = c.nth ?? 2;
  let at = -1;
  const re = /\bcase\b/g; let m, k = 0;
  while ((m = re.exec(code))) { if (++k === nth) { at = m.index; break; } }
  const eslint = run("no-duplicate-case", code, c);
  console.log(JSON.stringify(code) + "\n    eslint: " + (eslint.length ? eslint.join(" | ") : "(none)") + "\n    case#" + nth + " at " + lineCol(code, at));
}

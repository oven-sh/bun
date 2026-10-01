// Prints the rows of a Rust table from <inputs.json>: name, path, loader, text as a byte string, and the comments that tsc 6.0.2 reads (start, end, kind).
const { commentsOf } = require("./trivia-oracle.cjs");
const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const loaderName = { ts: "Ts", tsx: "Tsx", js: "Js", jsx: "Jsx" };
const esc = code => [...Buffer.from(code, "utf8")].map(b => b === 34 ? '\\"' : b === 92 ? "\\\\" : b === 10 ? "\\n" : b === 13 ? "\\r" : b === 9 ? "\\t" : b >= 32 && b < 127 ? String.fromCharCode(b) : "\\x" + b.toString(16).toUpperCase().padStart(2, "0")).join("");
for (const [name, loader, code] of inputs) {
  const { found, diags } = commentsOf(code, loader);
  if (diags) throw new Error(name + " has parse diagnostics");
  const b = i => Buffer.byteLength(code.slice(0, i), "utf8");
  const list = found.map(([pos, end, t]) => {
    const text = code.slice(pos, end);
    const k = t === ts.SyntaxKind.SingleLineCommentTrivia ? "L" : text.length >= 4 && text[2] === "*" && text[3] !== "/" ? "J" : "B";
    return `(${b(pos)}, ${b(end)}, ${k})`;
  });
  console.log(`("${name}", ${loaderName[loader]}, b"${esc(code)}", &[${list.join(", ")}]),`);
}

// Class A of a join2 file, coarse: by what tsc as a whole says (no grammar error of the checker / the first one) and by what a parse without lint does.
const fs = require("fs");
const readline = require("readline");
const file = process.argv[2];
const rl = readline.createInterface({ input: fs.createReadStream(file) });
const n = {};
const add = k => (n[k] = (n[k] ?? 0) + 1);
rl.on("line", line => {
  if (!line.includes('"cls":"A"')) return;
  const r = JSON.parse(line);
  if (r.cls !== "A") return;
  const valid = r.chk === null ? "chk?" : r.chk.length === 0 ? "no-grammar-error" : "grammar-error";
  const full = r.full === undefined ? "?" : r.full === null ? "full-accepts" : "full-rejects";
  const scan = r.scan === undefined ? "?" : r.scan === null ? "scan-accepts" : "scan-rejects";
  const lp = r.lintPlain ? "lintPlain-rejects" : "lintPlain-accepts";
  add(`${r.d} | ${valid} | ${scan} | ${full} | ${lp}`);
  add(`${r.d} | ${valid}`);
  add(`${r.d} | total`);
});
rl.on("close", () => { for (const k of Object.keys(n).sort()) console.log(String(n[k]).padStart(7), k); });

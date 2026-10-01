// usage: node make-test-rows.cjs expected.txt lint.proto.tla.txt plain.proto.tla.txt > test-rows.txt
// The rows of a Rust table for `mod tests` of syntax_errors.rs: every source whose first diagnostic in typescript-go (expected.txt)
// is what the prototype gives as the entry of its first message (SAME in compare.cjs), by group, for ts and for js.
// Each row: (source, loader, code, start, end, text). A second list has the sources that both take. A comment after a row says what a
// parse WITHOUT lint does with the source (plain.*.txt): `plain: ok` rows are the ones that only a lint parse rejects.
const fs = require("fs");
const read = file => {
  const map = new Map();
  let src = null;
  let group = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("== ")) group = line.slice(3);
    else if (line.startsWith('"')) {
      src = line;
      if (!map.has(src)) map.set(src, { group });
    } else if (src && /^  a\.(ts|js)  /.test(line)) {
      const value = line.slice(8);
      if (value.startsWith("tsc 6.0.2 differs")) continue;
      map.get(src)[line.slice(2, 6)] = value;
    }
  }
  return map;
};
const [ref, lint, plain] = [2, 3, 4].map(i => read(process.argv[i]));
const first = text => (text === "ok" ? "ok" : text.split(" | ")[0]);
const rust = json => "b" + JSON.stringify(JSON.parse(json)).replace(/\\u([0-9a-f]{4})/g, "\\u{$1}");
let group = null;
const accepted = [];
for (const [src, r] of ref) {
  for (const loader of ["a.ts", "a.js"]) {
    const want = first(r[loader] || "?");
    const have = first(lint.get(src)?.[loader] || "?");
    const entry = have === "ok" ? "ok" : (have.split(" -> ")[1] ?? "no entry");
    if (want !== entry) continue;
    const how = (plain.get(src)?.[loader] || "?").startsWith("ok") ? "plain: ok" : "plain: " + (plain.get(src)?.[loader] || "?").split(" | ")[0].replace(/^err /, "");
    const kind = loader === "a.ts" ? "Loader::Ts" : "Loader::Js";
    if (want === "ok") {
      accepted.push(`    (${rust(src)}, ${kind}), // ${how}`);
      continue;
    }
    const m = /^TS(\d+) (\d+)\+(\d+) (".*")$/.exec(want);
    if (r.group !== group) console.log(`\n// ${(group = r.group)}`);
    console.log(`    (${rust(src)}, ${kind}, ${m[1]}, ${m[2]}, ${Number(m[2]) + Number(m[3])}, ${m[4]}), // ${how}`);
  }
}
console.log("\n// What the reference parses and a lint parse takes");
console.log(accepted.join("\n"));

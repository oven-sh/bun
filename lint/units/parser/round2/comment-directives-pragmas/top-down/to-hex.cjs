// node to-hex.cjs : writes vectors/pragmas.hex (35 + 77 inputs of ../../../lexer-lint-hooks) and vectors/directives.hex (directives-inputs.json) as `name<TAB>hex` lines.
const fs = require("fs");
const path = require("path");
const hooks = path.join(__dirname, "..", "..", "..", "lexer-lint-hooks");
const hex = s => Buffer.from(s, "utf8").toString("hex");
const bottom = JSON.parse(fs.readFileSync(path.join(hooks, "bottom-up", "pragmas-inputs.json"), "utf8"));
const top = JSON.parse(fs.readFileSync(path.join(hooks, "top-down", "pragma-inputs.json"), "utf8")).map(([, s], i) => ["t" + String(i + 1).padStart(2, "0"), s]);
fs.writeFileSync(path.join(__dirname, "vectors", "pragmas.hex"), [...bottom, ...top].map(([n, s]) => `${n}\t${hex(s)}`).join("\n") + "\n");
const directives = JSON.parse(fs.readFileSync(path.join(__dirname, "directives-inputs.json"), "utf8"));
fs.writeFileSync(path.join(__dirname, "vectors", "directives.hex"), directives.map(([n, s]) => `${n}\t${hex(s)}`).join("\n") + "\n");

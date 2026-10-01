const { Linter } = require("eslint");
const linter = new Linter();
function run(rule, code, opts = {}) {
  const cfg = [{
    languageOptions: { ecmaVersion: "latest", sourceType: opts.sourceType ?? "script", parserOptions: { ecmaFeatures: { jsx: !!opts.jsx } } },
    rules: { [rule]: "error" },
  }];
  const msgs = linter.verify(code, cfg);
  return msgs.map(m => m.fatal ? `FATAL ${m.line}:${m.column} ${m.message}` : `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.ruleId} ${JSON.stringify(m.message)}`);
}
module.exports = { run };
if (require.main === module) {
  const rule = process.argv[2];
  const fs = require("fs");
  const cases = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  for (const c of cases) {
    const code = typeof c === "string" ? c : c.code;
    const out = run(rule, code, typeof c === "string" ? {} : c);
    console.log(JSON.stringify(code));
    if (out.length === 0) console.log("    (none)");
    for (const o of out) console.log("    " + o);
  }
}

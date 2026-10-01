const { Linter } = require("/tmp/eslint-oracle/node_modules/eslint");
const linter = new Linter();
function run(rules, code, sourceType = "module") {
  const cfg = [{ languageOptions: { ecmaVersion: "latest", sourceType }, rules: Object.fromEntries(rules.map(r => [r, "error"])) }];
  return linter.verify(code, cfg).map(m => m.fatal ? `FATAL ${m.line}:${m.column} ${m.message}` : `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.ruleId} ${JSON.stringify(m.message)}`);
}
const cases = [
  [["no-self-assign"], "({a, a} = {a})"],
  [["use-isnan"], "x === NaN === NaN"],
  [["use-isnan"], "(x === NaN) === NaN"],
  [["no-self-assign"], "[a, a] = [a, a]"],
  [["no-dupe-keys"], "({a: 1, a: 2, a: 3})"],
  [["no-debugger", "no-empty-pattern", "no-sparse-arrays"], "debugger; var {} = [,];"],
  [["no-compare-neg-zero", "use-isnan"], "NaN === -0"],
  [["no-unsafe-negation", "valid-typeof"], "!typeof a == 'strnig'"],
  [["no-dupe-keys","no-self-assign"], "a = a; ({b:1,b:2})"],
];
for (const [rules, code] of cases) {
  console.log(JSON.stringify(code), rules.join(","));
  for (const o of run(rules, code)) console.log("    " + o);
}
